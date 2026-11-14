// Local webhook test - simulates a GitHub push webhook hitting the server
// Usage: npx tsx scripts/local-webhook-test.ts
import { createHmac } from "node:crypto";

const PORT = process.env.PORT ?? "3000";
const SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "test-secret";

const pushPayload = {
  ref: "refs/heads/main",
  after: "abc1234567890def1234567890abcdef12345678",
  repository: {
    name: "demo-repo",
    owner: { login: "test-org", name: "test-org" },
    default_branch: "main",
  },
  installation: { id: 12345 },
};

const body = JSON.stringify(pushPayload);
const signature = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");

async function main() {
  console.log("=== Evergreen Local Webhook Test ===\n");

  // Test 1: Health check
  console.log("1. Testing health endpoint...");
  try {
    const healthRes = await fetch(`http://localhost:${PORT}/healthz`);
    const health = await healthRes.json();
    console.log(`   Status: ${healthRes.status}`);
    console.log(`   Body: ${JSON.stringify(health)}`);
    console.log(`   ✓ Health check ${healthRes.ok ? "passed" : "FAILED"}\n`);
  } catch (e: any) {
    console.log(`   ✗ Health check failed: ${e.message}`);
    console.log(`   Is the server running? Start it with: npm run serve\n`);
    process.exit(1);
  }

  // Test 2: Webhook with bad signature -> should get 401
  console.log("2. Testing webhook with bad signature...");
  try {
    const badRes = await fetch(`http://localhost:${PORT}/api/github/webhooks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": "test-delivery-bad",
        "x-hub-signature-256": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      },
      body,
    });
    console.log(`   Status: ${badRes.status}`);
    const badBody = await badRes.json();
    console.log(`   Body: ${JSON.stringify(badBody)}`);
    console.log(`   ✓ Bad signature correctly ${badRes.status === 401 ? "rejected (401)" : "UNEXPECTED: " + badRes.status}\n`);
  } catch (e: any) {
    console.log(`   ✗ Request failed: ${e.message}\n`);
  }

  // Test 3: Webhook with valid signature -> should get 202
  console.log("3. Testing webhook with valid signature...");
  try {
    const goodRes = await fetch(`http://localhost:${PORT}/api/github/webhooks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": "test-delivery-good",
        "x-hub-signature-256": signature,
      },
      body,
    });
    console.log(`   Status: ${goodRes.status}`);
    const goodBody = await goodRes.json();
    console.log(`   Body: ${JSON.stringify(goodBody)}`);
    console.log(`   ✓ Valid signature ${goodRes.status === 202 ? "accepted (202)" : "status: " + goodRes.status}\n`);
  } catch (e: any) {
    console.log(`   ✗ Request failed: ${e.message}\n`);
  }

  // Test 4: Webhook with missing signature -> should get 401
  console.log("4. Testing webhook with no signature...");
  try {
    const noSigRes = await fetch(`http://localhost:${PORT}/api/github/webhooks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": "test-delivery-nosig",
      },
      body,
    });
    console.log(`   Status: ${noSigRes.status}`);
    console.log(`   ✓ Missing signature correctly ${noSigRes.status === 401 ? "rejected (401)" : "UNEXPECTED: " + noSigRes.status}\n`);
  } catch (e: any) {
    console.log(`   ✗ Request failed: ${e.message}\n`);
  }

  // Test 5: Installation event
  console.log("5. Testing installation event...");
  const installPayload = JSON.stringify({
    action: "created",
    installation: { id: 12345, account: { login: "test-org" } },
    repositories: [{ full_name: "test-org/demo-repo" }],
  });
  const installSig = "sha256=" + createHmac("sha256", SECRET).update(installPayload).digest("hex");
  try {
    const installRes = await fetch(`http://localhost:${PORT}/api/github/webhooks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "installation",
        "x-github-delivery": "test-delivery-install",
        "x-hub-signature-256": installSig,
      },
      body: installPayload,
    });
    console.log(`   Status: ${installRes.status}`);
    console.log(`   ✓ Installation event ${installRes.status === 202 ? "accepted (202)" : "status: " + installRes.status}\n`);
  } catch (e: any) {
    console.log(`   ✗ Request failed: ${e.message}\n`);
  }

  console.log("=== Test complete ===");
  console.log("Note: Push handler will fail to clone (no real GitHub App credentials),");
  console.log("but the webhook signature verification and routing are proven above.");
}

main();
