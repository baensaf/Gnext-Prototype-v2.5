using System;
using System.Collections.Generic;
using System.IO;
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
        private static int Main()
        {
            var json = new JavaScriptSerializer();
            Console.OutputEncoding = new UTF8Encoding(false);
            var stdout = Console.Out;
            // The SDK may write to the console; keep stdout for the one response line.
            Console.SetOut(Console.Error);

            Dictionary<string, object> response;
            try
            {
                var input = Console.In.ReadLine() ?? "";
                var req = json.Deserialize<Request>(input) ?? new Request();
                response = Run(req);
            }
            catch (Exception ex)
            {
                response = Fail("connect", "bad request: " + ex.Message);
            }

            stdout.WriteLine(json.Serialize(response));
            stdout.Flush();
            return 0;
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
                // An exception before PcStarterPurchase was called is caught above as "connect";
                // anything left is from set-up.
                return Fail("connect", ex.GetType().Name + ": " + ex.Message);
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
