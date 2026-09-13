//go:build !windows

package main

import (
	"errors"
	"os/exec"
)

// The ARCLUME launcher is a Windows product. These stubs exist only so the
// package still builds and vets on other platforms.

func configureChildProcess(_ *exec.Cmd) {}

func superviseChild(_ *exec.Cmd) error { return nil }

func showErrorDialog(_, _ string) {}

func openBrowser(_ string) error {
	return errors.New("the ARCLUME native launcher only opens a browser on Windows")
}
