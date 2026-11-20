"use strict";

const should = require("should");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const execFile = promisify(require("child_process").execFile);
const utils = require("nr-test-utils");

describe("runtime backup recovery", function() {
    this.timeout(30000);
    let userDir;

    beforeEach(async function() {
        userDir = await fs.mkdtemp(path.join(os.tmpdir(), "nr-backup-recovery-"));
    });

    afterEach(async function() {
        await fs.remove(userDir);
    });

    it("runs the recovered flow and restores the primary file after an empty-file startup", async function() {
        const flow = [
            {id: "recovery-tab", type: "tab", label: "Recovered flow"},
            {id: "probe", type: "recovery-probe", z: "recovery-tab", wires: []}
        ];
        const primary = path.join(userDir, "flows.json");
        await fs.writeFile(primary, "");
        await fs.writeJson(path.join(userDir, ".flows.json.backup"), flow);

        // A separate runtime process keeps the real startup and storage singletons isolated.
        const script = `
            const RED = require(process.argv[1]);
            const http = require("http");
            const server = http.createServer();
            RED.init(server, {
                userDir: process.argv[2],
                flowFile: "flows.json",
                credentialSecret: "test-only-secret",
                telemetry: {enabled: false},
                editorTheme: {projects: {enabled: false}},
                logging: {console: {level: "info"}}
            });
            RED.nodes.registerType("recovery-probe", function(config) {
                RED.nodes.createNode(this, config);
                this.on("input", function(msg) {
                    console.log("RECOVERED:" + JSON.stringify(msg.payload));
                });
            });
            RED.events.once("flows:started", async function() {
                try {
                    const probe = RED.nodes.getNode("probe");
                    if (!probe) throw new Error("Recovered node did not start");
                    probe.receive({payload: "backup message"});
                    await RED.stop();
                } catch (err) {
                    console.error(err);
                    process.exitCode = 1;
                }
            });
            RED.start().catch(err => { console.error(err); process.exitCode = 1; });
        `;
        const result = await execFile(process.execPath, [
            "-e", script, utils.resolve("node-red/lib/red.js"), userDir
        ], {timeout: 25000}).catch(err => { throw new Error(err.stdout + "\n" + err.stderr); });
        result.stdout.should.containEql('RECOVERED:"backup message"');
        (await fs.readJson(primary)).should.eql(flow);
        (await fs.readJson(path.join(userDir, ".flows.json.backup"))).should.eql(flow);
    });
});



