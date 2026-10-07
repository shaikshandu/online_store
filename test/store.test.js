"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { test } = require("node:test");

const serverPath = path.join(__dirname, "..", "server.js");

async function startServer(dataDir, port = "0") {
    const child = spawn(process.execPath, [serverPath], {
        env: {
            ...process.env,
            ADMIN_PASSWORD: "test-only-password",
            DATA_DIR: dataDir,
            HOST: "127.0.0.1",
            PORT: port
        },
        stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    const address = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Server did not start. Output: ${output}`));
        }, 5000);
        child.stdout.on("data", (chunk) => {
            output += chunk.toString();
            const match = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
            if (match) {
                clearTimeout(timeout);
                resolve(`http://127.0.0.1:${match[1]}`);
            }
        });
        child.stderr.on("data", (chunk) => {
            output += chunk.toString();
        });
        child.once("exit", (code) => {
            clearTimeout(timeout);
            reject(new Error(`Server exited with ${code}. Output: ${output}`));
        });
    });

    return { child, address };
}

async function assertPortConflictIsReported(dataDir, port) {
    const child = spawn(process.execPath, [serverPath], {
        env: {
            ...process.env,
            ADMIN_PASSWORD: "test-only-password",
            DATA_DIR: dataDir,
            HOST: "127.0.0.1",
            PORT: String(port)
        },
        stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
        output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
        output += chunk.toString();
    });
    const [code] = await once(child, "exit");
    assert.notEqual(code, 0);
    assert.match(output, /already in use/);
    assert.match(output, /Stop the other store server with Ctrl\+C/);
}

async function stopServer(child) {
    if (child.exitCode !== null) return;
    child.kill();
    await once(child, "exit");
}

async function request(baseUrl, pathname, options = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, options);
    const body = await response.json();
    return { status: response.status, body };
}

test("counter sales and online orders share persistent stock", async (t) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "zepto-store-test-"));
    let running = await startServer(dataDir);
    t.after(async () => {
        if (running) await stopServer(running.child);
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    await assertPortConflictIsReported(
        dataDir,
        new URL(running.address).port
    );

    let result = await request(running.address, "/api/catalog");
    assert.equal(result.status, 200);
    assert.equal(result.body.products.length, 0);
    assert.equal((await request(running.address, "/database.sql")).status, 404);

    result = await request(running.address, "/api/admin/inventory");
    assert.equal(result.status, 401);

    result = await request(running.address, "/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test-only-password" })
    });
    assert.equal(result.status, 200);
    const authorization = { Authorization: `Bearer ${result.body.token}` };

    result = await request(running.address, "/api/admin/products", {
        method: "POST",
        headers: {
            ...authorization,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            name: "Test store milk",
            categoryId: 3,
            price: 32.5,
            mrp: 35,
            weight: "500 ml",
            stock: 12,
            image: ""
        })
    });
    assert.equal(result.status, 201);
    const milkProductId = result.body.id;

    result = await request(running.address, "/api/admin/inventory/adjust", {
        method: "POST",
        headers: {
            ...authorization,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            productId: milkProductId,
            action: "SALE",
            quantity: 3,
            reason: "Counter receipt 101"
        })
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.available, 9);

    result = await request(running.address, "/api/admin/products", {
        method: "POST",
        headers: {
            ...authorization,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            name: "Test farm eggs",
            categoryId: 3,
            price: 60,
            mrp: 65,
            weight: "6 pcs",
            stock: 5,
            image: ""
        })
    });
    assert.equal(result.status, 201);
    const newProductId = result.body.id;

    result = await request(running.address, "/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            customerName: "Test customer",
            customerPhone: "9876543210",
            address: "10 Test Street",
            pincode: "560001",
            paymentMethod: "COD",
            items: [{ productId: milkProductId, quantity: 2 }]
        })
    });
    assert.equal(result.status, 201);
    const orderNumber = result.body.orderNumber;

    result = await request(running.address, "/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            customerName: "Test customer",
            customerPhone: "9876543210",
            address: "10 Test Street",
            pincode: "560001",
            paymentMethod: "COD",
            items: [{ productId: milkProductId, quantity: 100 }]
        })
    });
    assert.equal(result.status, 409);

    result = await request(running.address, "/api/admin/orders", {
        headers: authorization
    });
    assert.equal(result.body.page, 1);
    assert.equal(result.body.hasMore, false);
    const order = result.body.orders.find((item) => item.order_number === orderNumber);
    assert.ok(order);
    assert.equal(order.items[0].name, "Test store milk");
    assert.equal(order.items[0].quantity, 2);
    assert.equal(order.items[0].unit_price, 32.5);
    for (const status of ["PREPARING", "OUT_FOR_DELIVERY", "CANCELLED"]) {
        result = await request(
            running.address,
            `/api/admin/orders/${order.id}/status`,
            {
                method: "PATCH",
                headers: {
                    ...authorization,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ status })
            }
        );
        assert.equal(result.status, 200);
    }

    result = await request(running.address, "/api/admin/products", {
        method: "POST",
        headers: {
            ...authorization,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            name: "History pagination test product",
            categoryId: 3,
            price: 1,
            mrp: 1,
            weight: "1 pc",
            stock: 60,
            image: ""
        })
    });
    assert.equal(result.status, 201);
    const historyProductId = result.body.id;
    for (let index = 0; index < 51; index += 1) {
        result = await request(running.address, "/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                customerName: "History test",
                customerPhone: "9876543210",
                address: "10 Test Street",
                pincode: "560001",
                paymentMethod: "COD",
                items: [{ productId: historyProductId, quantity: 1 }]
            })
        });
        assert.equal(result.status, 201);
    }
    result = await request(running.address, "/api/admin/orders?page=1", {
        headers: authorization
    });
    assert.equal(result.body.orders.length, 50);
    assert.equal(result.body.hasMore, true);
    result = await request(running.address, "/api/admin/orders?page=2", {
        headers: authorization
    });
    assert.equal(result.body.orders.length, 2);
    assert.equal(result.body.hasMore, false);
    assert.equal(
        result.body.orders[1].items[0].name,
        "Test store milk"
    );
    assert.equal(
        (await request(running.address, "/api/admin/orders?page=0", {
            headers: authorization
        })).status,
        400
    );

    await stopServer(running.child);
    running = await startServer(dataDir);

    result = await request(running.address, "/api/catalog");
    assert.equal(result.status, 200);
    assert.equal(
        result.body.products.find((item) => item.id === milkProductId).available,
        9
    );
    assert.equal(
        result.body.products.find((item) => item.id === newProductId).available,
        5
    );
    assert.equal(
        result.body.products.find((item) => item.id === historyProductId).available,
        9
    );

    result = await request(running.address, "/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test-only-password" })
    });
    const restartedAuthorization = {
        Authorization: `Bearer ${result.body.token}`
    };
    result = await request(running.address, "/api/admin/orders?page=2", {
        headers: restartedAuthorization
    });
    assert.equal(result.body.orders[1].items[0].name, "Test store milk");
});
