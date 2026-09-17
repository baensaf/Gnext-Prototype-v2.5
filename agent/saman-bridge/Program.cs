using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Configuration;
using System.IO;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;
using SSP1126.PcPos.BaseClasses;
using SSP1126.PcPos.Infrastructure;

namespace Gnext.SamanBridge
{
    /// <summary>
    /// Runs one Saman PC-POS operation and exits. The Go agent writes one JSON request to stdin
    /// and reads one JSON response from stdout; Saman's SDK logs go to stderr and its own log
    /// folder. The agent kills the process if it outlives the charge timeout.
    ///
    /// Request:  {"op":"test|charge|inquiry","media":"lan|com","ip":"192.168.1.60","com":"COM3",
    ///            "timeout_s":90,"amount":"1250000","rrn":"..."}
    /// Response: {"ok":true,"stage":"done","result":{...}} or
    ///           {"ok":false,"stage":"connect|send","error":"..."}
    ///
    /// stage tells the agent whether the amount could have reached the terminal: "connect" means
    /// it certainly did not (safe to report FAILED), "send" means it may have (report UNKNOWN).
    /// </summary>
    internal static class Program
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static readonly object Answered = new object();
        private static TextWriter _stdout;
        private static bool _answered;

        /// <summary>"connect" until the amount is handed to the SDK, then "send".</summary>
        private static volatile string _stage = "connect";

        private static int Main()
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            _stdout = Console.Out;
            // The SDK may write to the console; keep stdout for the one response line.
            Console.SetOut(Console.Error);

            // Saman's SDK does work on background threads; if one of them throws, the process dies.
            // Answer first, with the stage we had reached, so the agent can tell FAILED from UNKNOWN.
            AppDomain.CurrentDomain.UnhandledException += (_, e) =>
                Answer(Fail(_stage, "Saman SDK crashed: " + ((e.ExceptionObject as Exception)?.Message ?? "unknown error")));

            Dictionary<string, object> response;
            try
            {
                UseWritableLogFolder();
                var input = Console.In.ReadLine() ?? "";
                var req = Json.Deserialize<Request>(input) ?? new Request();
                response = Run(req);
            }
            catch (Exception ex)
            {
                response = Fail(_stage, ex.GetType().Name + ": " + ex.Message);
            }

            Answer(response);
            return 0;
        }

        private static void Answer(Dictionary<string, object> response)
        {
            lock (Answered)
            {
                if (_answered) return;
                _answered = true;
                _stdout.WriteLine(Json.Serialize(response));
                _stdout.Flush();
            }
        }

        /// <summary>
        /// Saman's logger crashes the process when it cannot create its folder. Point it at
        /// GNEXT_SAMAN_LOG_DIR (set by the agent), else the configured folder, else %TEMP%,
        /// whichever can actually be created.
        /// </summary>
        private static void UseWritableLogFolder()
        {
            var settings = ConfigurationManager.AppSettings;
            var candidates = new[]
            {
                Environment.GetEnvironmentVariable("GNEXT_SAMAN_LOG_DIR"),
                settings["LogBasePath"],
                Path.Combine(Path.GetTempPath(), "gnext-saman-logs"),
            };
            foreach (var dir in candidates)
            {
                if (string.IsNullOrWhiteSpace(dir)) continue;
                try
                {
                    Directory.CreateDirectory(dir);
                    var probe = Path.Combine(dir, ".write-test");
                    File.WriteAllText(probe, "");
                    File.Delete(probe);
                }
                catch
                {
                    continue;
                }
                if (dir == settings["LogBasePath"]) return;
                // AppSettings is read-only at run time; the SDK only reads it, so unlock it once.
                var readOnly = typeof(NameObjectCollectionBase).GetField("_readOnly", BindingFlags.NonPublic | BindingFlags.Instance);
                readOnly?.SetValue(settings, false);
                settings["LogBasePath"] = dir;
                settings["LogPath"] = dir.TrimEnd('\\') + "\\";
                return;
            }
            // No writable folder at all: leave the SDK's settings; the crash handler still answers.
        }

        private static Dictionary<string, object> Run(Request req)
        {
            if (req.op == "version")
                return Done(new Dictionary<string, object> { { "sdk_version", typeof(PcPosFactory).Assembly.GetName().Version.ToString() } });

            var factory = new PcPosFactory();
            try
            {
                string media = (req.media ?? "lan").ToLowerInvariant();
                bool selected = media == "com"
                    ? factory.SetCom(req.com ?? "")
                    : factory.SetLan(req.ip ?? "");
                if (!selected)
                    return Fail("connect", media == "com" ? "cannot open " + req.com : "cannot reach " + req.ip);

                int timeout = req.timeout_s > 0 ? req.timeout_s : 90;
                switch (req.op)
                {
                    case "test":
                    {
                        factory.Initialization(ResponseLanguage.English, Math.Min(timeout, 15), AsyncType.Sync);
                        var r = factory.ConnectionTest();
                        if (r == null || r.ResponseCode != "00")
                            return Fail("connect", Describe(r, "no answer to connection test"));
                        return Done(Result(r));
                    }

                    case "charge":
                    {
                        // Prove the terminal answers before sending any amount, so a dead link is a
                        // certain failure rather than an unknown charge.
                        factory.Initialization(ResponseLanguage.English, 15, AsyncType.Sync);
                        var probe = factory.ConnectionTest();
                        if (probe == null || probe.ResponseCode != "00")
                            return Fail("connect", Describe(probe, "terminal did not answer the connection test"));

                        factory.Initialization(ResponseLanguage.Persian, timeout, AsyncType.Sync);
                        PosResult r;
                        try
                        {
                            _stage = "send";
                            r = factory.PcStarterPurchase(req.amount ?? "", string.Empty, string.Empty, string.Empty,
                                string.Empty, string.Empty, string.Empty, 0, string.Empty, 0);
                        }
                        catch (Exception ex)
                        {
                            return Fail("send", ex.GetType().Name + ": " + ex.Message);
                        }
                        if (r == null)
                            return Fail("send", "no result from the terminal");
                        return Done(Result(r));
                    }

                    case "inquiry":
                    {
                        factory.Initialization(ResponseLanguage.Persian, Math.Min(timeout, 60), AsyncType.Sync);
                        var r = factory.Inquiry(req.rrn ?? "");
                        if (r == null)
                            return Fail("send", "no answer to inquiry");
                        return Done(Result(r));
                    }

                    default:
                        return Fail("connect", "unknown op " + req.op);
                }
            }
            catch (Exception ex)
            {
                return Fail(_stage, ex.GetType().Name + ": " + ex.Message);
            }
            finally
            {
                try { factory.Dispose(); } catch { }
            }
        }

        private static string Describe(PosResult r, string fallback)
        {
            if (r == null) return fallback;
            return string.Format("{0} {1}", r.ResponseCode, r.ResponseDescription).Trim();
        }

        private static Dictionary<string, object> Result(PosResult r)
        {
            return new Dictionary<string, object>
            {
                { "response_code", r.ResponseCode },
                { "response_description", r.ResponseDescription },
                { "rrn", r.RRN },
                { "trace_number", r.TraceNumber },
                { "serial_id", r.SerialId },
                { "terminal_id", r.TerminalId },
                // The SDK can return the plain card number too; it is never read here.
                { "card_number_mask", r.CardNumberMask },
                { "req_amount", r.ReqAmount },
                { "affective_amount", r.AffectiveAmount },
                { "paid_amount", r.PaidAmount },
                { "txn_date", r.TxnDate },
                { "pos_version", r.POS_Version },
            };
        }

        private static Dictionary<string, object> Done(Dictionary<string, object> result)
        {
            return new Dictionary<string, object> { { "ok", true }, { "stage", "done" }, { "result", result } };
        }

        private static Dictionary<string, object> Fail(string stage, string error)
        {
            return new Dictionary<string, object> { { "ok", false }, { "stage", stage }, { "error", error } };
        }
    }

    internal sealed class Request
    {
        public string op { get; set; }
        public string media { get; set; }
        public string ip { get; set; }
        public string com { get; set; }
        public int timeout_s { get; set; }
        public string amount { get; set; }
        public string rrn { get; set; }
    }
}
