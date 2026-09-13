//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"syscall"
	"unsafe"
)

var (
	kernel32                     = syscall.NewLazyDLL("kernel32.dll")
	procCreateJobObjectW         = kernel32.NewProc("CreateJobObjectW")
	procSetInformationJobObject  = kernel32.NewProc("SetInformationJobObject")
	procAssignProcessToJobObject = kernel32.NewProc("AssignProcessToJobObject")
	procOpenProcess              = kernel32.NewProc("OpenProcess")

	user32          = syscall.NewLazyDLL("user32.dll")
	procMessageBoxW = user32.NewProc("MessageBoxW")
)

const (
	createNoWindow = 0x08000000

	processTerminate = 0x0001
	processSetQuota  = 0x0100

	jobObjectExtendedLimitInformation = 9
	jobObjectLimitKillOnJobClose      = 0x00002000

	mbOK          = 0x00000000
	mbIconError   = 0x00000010
	mbSystemModal = 0x00001000
)

type ioCounters struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type jobObjectBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type jobObjectExtendedLimitInformationStruct struct {
	BasicLimitInformation jobObjectBasicLimitInformation
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

// jobHandle is deliberately package scoped: the job must stay open for the
// whole life of the launcher. When the launcher process dies — cleanly, via
// Ctrl+C, or because the console window was closed — Windows closes this
// handle and terminates every process in the job.
var jobHandle syscall.Handle

// configureChildProcess keeps the bundled Node runtime from flashing its own
// console window when ARCLUME.exe is double-clicked.
func configureChildProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
}

// superviseChild puts the child into a kill-on-close job object so it can
// never outlive the launcher.
func superviseChild(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return fmt.Errorf("child process not started")
	}

	if jobHandle == 0 {
		handle, _, err := procCreateJobObjectW.Call(0, 0)
		if handle == 0 {
			return fmt.Errorf("CreateJobObject failed: %w", err)
		}
		jobHandle = syscall.Handle(handle)

		info := jobObjectExtendedLimitInformationStruct{}
		info.BasicLimitInformation.LimitFlags = jobObjectLimitKillOnJobClose
		ret, _, err := procSetInformationJobObject.Call(
			uintptr(jobHandle),
			uintptr(jobObjectExtendedLimitInformation),
			uintptr(unsafe.Pointer(&info)),
			unsafe.Sizeof(info),
		)
		if ret == 0 {
			return fmt.Errorf("SetInformationJobObject failed: %w", err)
		}
	}

	procHandle, _, err := procOpenProcess.Call(
		uintptr(processTerminate|processSetQuota),
		0,
		uintptr(cmd.Process.Pid),
	)
	if procHandle == 0 {
		return fmt.Errorf("OpenProcess failed: %w", err)
	}
	defer syscall.CloseHandle(syscall.Handle(procHandle))

	ret, _, err := procAssignProcessToJobObject.Call(uintptr(jobHandle), procHandle)
	if ret == 0 {
		return fmt.Errorf("AssignProcessToJobObject failed: %w", err)
	}
	return nil
}

// showErrorDialog surfaces a fatal error to a user who double-clicked the
// launcher and may never see a console.
func showErrorDialog(title, message string) {
	titlePtr, err := syscall.UTF16PtrFromString(title)
	if err != nil {
		return
	}
	messagePtr, err := syscall.UTF16PtrFromString(message)
	if err != nil {
		return
	}
	_, _, _ = procMessageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(messagePtr)),
		uintptr(unsafe.Pointer(titlePtr)),
		uintptr(mbOK|mbIconError|mbSystemModal),
	)
}

// openBrowser hands the already-validated loopback URL to the user's default
// browser without going through a shell.
func openBrowser(url string) error {
	cmd := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", url)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}
