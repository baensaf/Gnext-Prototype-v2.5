//go:build windows

package main

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// killChildrenOnExit puts the agent in a job object that ends every child process (the
// headless browser that renders tickets) when the agent exits, even if it crashes or is killed.
// Breakaway is allowed because a job cannot span sessions: the browser the service starts in
// the signed-in user's session leaves this job for one of its own (see printing).
func killChildrenOnExit() {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | windows.JOB_OBJECT_LIMIT_BREAKAWAY_OK,
		},
	}
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		windows.CloseHandle(job)
		return
	}
	if err := windows.AssignProcessToJobObject(job, windows.CurrentProcess()); err != nil {
		windows.CloseHandle(job)
	}
	// The handle stays open for the life of the process; closing it at exit kills the children.
}
