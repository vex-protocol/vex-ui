#!/usr/bin/env node

const readline = require("node:readline");

const deviceLinePattern =
    /^(\s+- ).*(iPhone|iPad|iPod|Apple Watch|Apple TV|Vision Pro)\s+\(UDID: \[redacted\]\).*$/;

function redact(line) {
    return line
        .replace(/(UDID:\s*)[A-Fa-f0-9-]+/g, "$1[redacted]")
        .replace(/(Provisioned devices\s+- ).*/g, "$1[redacted device]")
        .replace(deviceLinePattern, "$1[redacted device]");
}

const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
});

rl.on("line", (line) => {
    process.stderr.write(`${redact(line)}\n`);
});
