// Command ARCLUME is the native Windows launcher for the packaged ARCLUME
// distribution (portable ZIP and Inno Setup installer).
//
// It owns one child process for its whole life: the bundled Node runtime
// running the bundled ARCLUME Web server. It discovers the loopback URL the
// server prints, requires an HTTP 200 before doing anything user visible, then
// opens the default browser. When the launcher exits, the child dies with it.
//
// Everything it needs is resolved relative to the executable, never relative
// to the current working directory, so a Start Menu shortcut, a desktop
// shortcut and a double-click from Explorer all behave identically.
package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

// version is stamped at build time from package.json via
// -ldflags "-X main.version=<version>".
var version = "0.0.0-dev"

const (
	urlWaitTimeout   = 60 * time.Second
	readyWaitTimeout = 30 * time.Second
	shutdownTimeout  = 15 * time.Second
)

// The server must report a bare loopback URL. Anything else is refused.
var (
	loopbackURLExact  = regexp.MustCompile(`^http://127\.0\.0\.1:\d+$`)
	loopbackURLInText = regexp.MustCompile(`http://127\.0\.0\.1:\d+`)
)

type options struct {
	smokeTest bool
	noBrowser bool
	showHelp  bool
	version   bool
}

func parseArgs(args []string) (options, error) {
	var opts options
	for _, arg := range args {
		switch strings.ToLower(arg) {
		case "--smoke-test", "-smoke-test", "/smoke-test":
			opts.smokeTest = true
		case "--no-browser", "-no-browser", "/no-browser":
			opts.noBrowser = true
		case "--help", "-h", "/?":
			opts.showHelp = true
		case "--version", "-v":
			opts.version = true
		default:
			return opts, fmt.Errorf("unknown argument %q", arg)
		}
	}
	if os.Getenv("ARCLUME_SMOKE_TEST") == "1" {
		opts.smokeTest = true
	}
	if os.Getenv("ARCLUME_NO_BROWSER") == "1" {
		opts.noBrowser = true
	}
	return opts, nil
}

const usage = `ARCLUME - Local Visual Narrative Workspace

Usage:
  ARCLUME.exe                Start ARCLUME and open it in the default browser.
  ARCLUME.exe --no-browser   Start ARCLUME without opening a browser.
  ARCLUME.exe --smoke-test   Start ARCLUME, require HTTP 200, stop, exit 0.
  ARCLUME.exe --version      Print the ARCLUME version.
  ARCLUME.exe --help         Show this message.

Environment:
  ARCLUME_SMOKE_TEST=1       Same as --smoke-test.
  ARCLUME_NO_BROWSER=1       Same as --no-browser.
`

func main() {
	opts, err := parseArgs(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if opts.showHelp {
		fmt.Print(usage)
		os.Exit(0)
	}
	if opts.version {
		fmt.Println(version)
		os.Exit(0)
	}
	os.Exit(run(opts))
}

// -------------------------------------------------------------------------
// Layout
// -------------------------------------------------------------------------

// layout is the on-disk shape of a packaged ARCLUME distribution, resolved
// from the location of the executable.
type layout struct {
	root     string // directory containing ARCLUME.exe
	node     string // runtime\node.exe
	cli      string // app\node_modules\arclume\dist\cli\index.js
	appRoot  string // app\node_modules\arclume
	browsers string // browsers\  (PLAYWRIGHT_BROWSERS_PATH)
	dataDir  string // %LOCALAPPDATA%\ARCLUME
	logDir   string // %LOCALAPPDATA%\ARCLUME\logs
	logFile  string
}

func resolveLayout() (layout, error) {
	var l layout

	exe, err := os.Executable()
	if err != nil {
		return l, fmt.Errorf("cannot locate ARCLUME.exe: %w", err)
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	l.root = filepath.Dir(exe)

	l.node = filepath.Join(l.root, "runtime", "node.exe")
	l.appRoot = filepath.Join(l.root, "app", "node_modules", "arclume")
	l.cli = filepath.Join(l.appRoot, "dist", "cli", "index.js")
	l.browsers = filepath.Join(l.root, "browsers")

	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		// No per-user profile (rare, e.g. some service contexts): fall back to
		// a directory next to the executable rather than writing nowhere.
		base = l.root
	}
	l.dataDir = filepath.Join(base, "ARCLUME")
	l.logDir = filepath.Join(l.dataDir, "logs")
	l.logFile = filepath.Join(l.logDir, "arclume-launcher.log")

	return l, nil
}

func (l layout) verify() error {
	missing := []string{}
	if !fileExists(l.node) {
		missing = append(missing, "runtime\\node.exe")
	}
	if !fileExists(l.cli) {
		missing = append(missing, "app\\node_modules\\arclume\\dist\\cli\\index.js")
	}
	if len(missing) > 0 {
		return fmt.Errorf(
			"this ARCLUME installation is incomplete; missing: %s",
			strings.Join(missing, ", "),
		)
	}
	return nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// -------------------------------------------------------------------------
// Logging
// -------------------------------------------------------------------------

type logger struct {
	mu   sync.Mutex
	file *os.File
	path string
}

func newLogger(path string) *logger {
	lg := &logger{path: path}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err == nil {
		// Truncate per run: this log is a diagnostic for the current start,
		// and it must never grow without bound in a user profile.
		if f, err := os.Create(path); err == nil {
			lg.file = f
		}
	}
	return lg
}

func (l *logger) logf(format string, args ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	line := fmt.Sprintf("[%s] %s", time.Now().Format("2006-01-02 15:04:05"), fmt.Sprintf(format, args...))
	fmt.Fprintln(os.Stdout, line)
	if l.file != nil {
		fmt.Fprintln(l.file, line)
	}
}

func (l *logger) close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file != nil {
		_ = l.file.Close()
		l.file = nil
	}
}

// -------------------------------------------------------------------------
// Run
// -------------------------------------------------------------------------

func run(opts options) int {
	l, err := resolveLayout()
	if err != nil {
		reportFatal(opts, "", err.Error())
		return 1
	}

	lg := newLogger(l.logFile)
	defer lg.close()

	lg.logf("=== ARCLUME %s launcher started ===", version)
	lg.logf("Install root: %s", l.root)
	lg.logf("Node runtime: %s", l.node)
	lg.logf("Application:  %s", l.cli)
	lg.logf("Browsers:     %s", l.browsers)
	lg.logf("Log file:     %s", l.logFile)
	if opts.smokeTest {
		lg.logf("Mode: smoke test (no browser)")
	}

	if err := l.verify(); err != nil {
		lg.logf("ERROR: %v", err)
		reportFatal(opts, l.logFile, err.Error())
		return 1
	}

	if err := os.MkdirAll(l.dataDir, 0o755); err != nil {
		lg.logf("WARN: could not create data directory %s: %v", l.dataDir, err)
	}

	srv := &server{layout: l, log: lg}
	if err := srv.start(); err != nil {
		lg.logf("ERROR: %v", err)
		srv.stop()
		reportFatal(opts, l.logFile, "ARCLUME could not start its local server.")
		return 1
	}
	defer srv.stop()

	url, err := srv.waitForURL(urlWaitTimeout)
	if err != nil {
		lg.logf("ERROR: %v", err)
		srv.dumpOutput()
		reportFatal(opts, l.logFile, "ARCLUME did not report a local address.")
		return 1
	}
	if !loopbackURLExact.MatchString(url) {
		lg.logf("ERROR: refusing non-loopback address %q", url)
		srv.dumpOutput()
		reportFatal(opts, l.logFile, "ARCLUME reported an unexpected address and was stopped.")
		return 1
	}
	lg.logf("Discovered URL: %s", url)

	if err := waitForHTTP200(url, readyWaitTimeout, srv); err != nil {
		lg.logf("ERROR: %v", err)
		srv.dumpOutput()
		reportFatal(opts, l.logFile, "ARCLUME started but never became ready.")
		return 1
	}
	lg.logf("Server ready (HTTP 200)")

	if opts.smokeTest {
		srv.stop()
		if srv.exitedCleanly() {
			lg.logf("Smoke test PASS: %s", url)
			fmt.Printf("ARCLUME smoke test PASS (%s)\n", url)
			return 0
		}
		lg.logf("ERROR: smoke test could not confirm a clean shutdown")
		return 1
	}

	fmt.Println()
	fmt.Println("==========================================")
	fmt.Println(" ARCLUME")
	fmt.Println(" Local Visual Narrative Workspace")
	fmt.Println("==========================================")
	fmt.Println()
	fmt.Println("ARCLUME is running:")
	fmt.Println("  " + url)
	fmt.Println()
	fmt.Println("Close this window (or press Ctrl+C) to stop ARCLUME.")
	fmt.Println()

	if opts.noBrowser {
		lg.logf("Browser launch skipped (--no-browser)")
	} else {
		if err := openBrowser(url); err != nil {
			lg.logf("WARN: could not open the default browser: %v", err)
			fmt.Println("Could not open your browser automatically. Open the address above.")
		} else {
			lg.logf("Opened default browser")
		}
	}

	waitForShutdown(srv, lg)
	lg.logf("ARCLUME launcher exiting")
	return 0
}

func waitForShutdown(srv *server, lg *logger) {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)

	select {
	case <-srv.done:
		lg.logf("ARCLUME server exited on its own")
	case sig := <-signals:
		lg.logf("Received %s; stopping ARCLUME", sig)
	}
	srv.stop()
}

// -------------------------------------------------------------------------
// Server child process
// -------------------------------------------------------------------------

type server struct {
	layout layout
	log    *logger

	cmd  *exec.Cmd
	done chan struct{}

	urlOnce sync.Once
	urlCh   chan string

	mu       sync.Mutex
	output   []string
	stopped  bool
	waitErr  error
	waitDone bool
}

func (s *server) start() error {
	s.done = make(chan struct{})
	s.urlCh = make(chan string, 1)

	cmd := exec.Command(s.layout.node, s.layout.cli, "web")
	// Resolve nothing from the caller's working directory: run from a
	// per-user data directory so stray relative writes never land in the
	// installation directory.
	cmd.Dir = s.layout.dataDir
	if !dirExists(cmd.Dir) {
		cmd.Dir = s.layout.root
	}

	env := os.Environ()
	if dirExists(s.layout.browsers) {
		env = append(env, "PLAYWRIGHT_BROWSERS_PATH="+s.layout.browsers)
	}
	// The bundled runtime is the only Node this process may ever use.
	env = append(env, "ARCLUME_BUNDLED_RUNTIME=1")
	cmd.Env = env

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("cannot capture server stdout: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("cannot capture server stderr: %w", err)
	}
	configureChildProcess(cmd)

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("cannot start the bundled Node runtime: %w", err)
	}
	s.cmd = cmd
	s.log.logf("Owned server PID: %d", cmd.Process.Pid)

	// Kill-on-close job object: if this launcher dies for any reason, Windows
	// terminates the server with it. No orphaned node.exe, no stuck port.
	if err := superviseChild(cmd); err != nil {
		s.log.logf("WARN: could not attach the server to a job object: %v", err)
	}

	go s.scan("stdout", stdout)
	go s.scan("stderr", stderr)
	go func() {
		err := cmd.Wait()
		s.mu.Lock()
		s.waitErr = err
		s.waitDone = true
		s.mu.Unlock()
		close(s.done)
	}()

	return nil
}

func (s *server) scan(stream string, r io.Reader) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		s.mu.Lock()
		if len(s.output) < 500 {
			s.output = append(s.output, stream+": "+line)
		}
		s.mu.Unlock()
		if match := loopbackURLInText.FindString(line); match != "" {
			s.urlOnce.Do(func() { s.urlCh <- match })
		}
	}
}

func (s *server) waitForURL(timeout time.Duration) (string, error) {
	select {
	case url := <-s.urlCh:
		return url, nil
	case <-s.done:
		// Give the scanners a moment to drain the last buffered line.
		select {
		case url := <-s.urlCh:
			return url, nil
		case <-time.After(500 * time.Millisecond):
		}
		return "", errors.New("the ARCLUME server exited before reporting an address")
	case <-time.After(timeout):
		return "", fmt.Errorf("the ARCLUME server reported no address within %s", timeout)
	}
}

func (s *server) exited() bool {
	select {
	case <-s.done:
		return true
	default:
		return false
	}
}

func (s *server) exitedCleanly() bool {
	select {
	case <-s.done:
	case <-time.After(shutdownTimeout):
		return false
	}
	return true
}

func (s *server) stop() {
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		return
	}
	s.stopped = true
	cmd := s.cmd
	s.mu.Unlock()

	if cmd == nil || cmd.Process == nil {
		return
	}
	if s.exited() {
		return
	}

	s.log.logf("Stopping ARCLUME server (owned PID: %d)", cmd.Process.Pid)
	if err := cmd.Process.Kill(); err != nil {
		s.log.logf("WARN: could not stop the owned server process: %v", err)
	}
	select {
	case <-s.done:
		s.log.logf("Owned server process exited")
	case <-time.After(shutdownTimeout):
		s.log.logf("WARN: timed out waiting for the owned server process to exit")
	}
}

func (s *server) dumpOutput() {
	s.mu.Lock()
	lines := append([]string(nil), s.output...)
	s.mu.Unlock()

	s.log.logf("--- ARCLUME server output ---")
	if len(lines) == 0 {
		s.log.logf("(no output)")
	}
	for _, line := range lines {
		s.log.logf("%s", line)
	}
	s.log.logf("--- end of server output ---")
}

// -------------------------------------------------------------------------
// Readiness
// -------------------------------------------------------------------------

func waitForHTTP200(url string, timeout time.Duration, srv *server) error {
	client := &http.Client{Timeout: 5 * time.Second}
	deadline := time.Now().Add(timeout)
	var lastErr error

	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64*1024))
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
			lastErr = fmt.Errorf("server answered HTTP %d", resp.StatusCode)
		} else {
			lastErr = err
		}
		if srv != nil && srv.exited() {
			return fmt.Errorf("the ARCLUME server exited before becoming ready (last error: %v)", lastErr)
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("no HTTP 200 from %s within %s (last error: %v)", url, timeout, lastErr)
}

// -------------------------------------------------------------------------
// Fatal error UX
// -------------------------------------------------------------------------

func reportFatal(opts options, logPath, message string) {
	text := "ARCLUME could not start.\n\n" + message
	if logPath != "" {
		text += "\n\nSee: " + logPath
	}
	fmt.Fprintln(os.Stderr)
	fmt.Fprintln(os.Stderr, text)
	fmt.Fprintln(os.Stderr)

	// A double-clicked launcher may have no console the user will ever read,
	// so fatal errors also surface as a native dialog. Never in automation.
	if !opts.smokeTest && !opts.noBrowser {
		showErrorDialog("ARCLUME", text)
	}
}
