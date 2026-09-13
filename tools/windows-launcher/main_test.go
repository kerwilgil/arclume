package main

import "testing"

func TestParseArgs(t *testing.T) {
	t.Setenv("ARCLUME_SMOKE_TEST", "")
	t.Setenv("ARCLUME_NO_BROWSER", "")

	cases := []struct {
		name string
		args []string
		want options
	}{
		{"no arguments", nil, options{}},
		{"smoke test", []string{"--smoke-test"}, options{smokeTest: true}},
		{"no browser", []string{"--no-browser"}, options{noBrowser: true}},
		{"both", []string{"--smoke-test", "--no-browser"}, options{smokeTest: true, noBrowser: true}},
		{"help", []string{"--help"}, options{showHelp: true}},
		{"version", []string{"--version"}, options{version: true}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseArgs(tc.args)
			if err != nil {
				t.Fatalf("parseArgs(%v) returned error: %v", tc.args, err)
			}
			if got != tc.want {
				t.Fatalf("parseArgs(%v) = %+v, want %+v", tc.args, got, tc.want)
			}
		})
	}
}

func TestParseArgsRejectsUnknownArguments(t *testing.T) {
	if _, err := parseArgs([]string{"--launch-everything"}); err == nil {
		t.Fatal("expected an error for an unknown argument")
	}
}

func TestParseArgsHonoursEnvironment(t *testing.T) {
	t.Setenv("ARCLUME_SMOKE_TEST", "1")
	opts, err := parseArgs(nil)
	if err != nil {
		t.Fatalf("parseArgs returned error: %v", err)
	}
	if !opts.smokeTest {
		t.Fatal("ARCLUME_SMOKE_TEST=1 should enable smoke-test mode")
	}
}

// The launcher must only ever act on a bare loopback address. Anything with a
// host, a path, a different address or a different scheme is refused before it
// reaches a browser.
func TestLoopbackURLValidation(t *testing.T) {
	accepted := []string{
		"http://127.0.0.1:3210",
		"http://127.0.0.1:1",
		"http://127.0.0.1:65535",
	}
	for _, url := range accepted {
		if !loopbackURLExact.MatchString(url) {
			t.Errorf("expected %q to be accepted", url)
		}
	}

	refused := []string{
		"http://0.0.0.0:3210",
		"http://localhost:3210",
		"http://192.168.1.10:3210",
		"http://[::1]:3210",
		"https://127.0.0.1:3210",
		"http://127.0.0.1:3210/deck",
		"http://127.0.0.1:3210 http://evil.example",
		"http://127.0.0.1",
		"",
	}
	for _, url := range refused {
		if loopbackURLExact.MatchString(url) {
			t.Errorf("expected %q to be refused", url)
		}
	}
}

func TestLoopbackURLExtraction(t *testing.T) {
	line := "ARCLUME Web: http://127.0.0.1:51234 (loopback only)"
	if got := loopbackURLInText.FindString(line); got != "http://127.0.0.1:51234" {
		t.Fatalf("extracted %q", got)
	}
	if got := loopbackURLInText.FindString("nothing to see here"); got != "" {
		t.Fatalf("expected no match, got %q", got)
	}
}

// The layout must be derived from the executable, never from the working
// directory, so shortcuts and Explorer double-clicks behave identically.
func TestResolveLayoutIsExecutableRelative(t *testing.T) {
	l, err := resolveLayout()
	if err != nil {
		t.Fatalf("resolveLayout returned error: %v", err)
	}
	if l.root == "" {
		t.Fatal("layout root is empty")
	}
	for name, path := range map[string]string{
		"node":     l.node,
		"cli":      l.cli,
		"browsers": l.browsers,
	} {
		if len(path) <= len(l.root) || path[:len(l.root)] != l.root {
			t.Errorf("%s path %q is not under the executable directory %q", name, path, l.root)
		}
	}
	if l.logFile == "" {
		t.Fatal("log file path is empty")
	}
}

func TestVerifyReportsMissingPayload(t *testing.T) {
	l := layout{
		root: t.TempDir(),
		node: t.TempDir() + "\\missing-node.exe",
		cli:  t.TempDir() + "\\missing-cli.js",
	}
	err := l.verify()
	if err == nil {
		t.Fatal("expected verify to fail on an incomplete layout")
	}
}
