"use strict";

const DELIVERY_FEE = 25;
const ADMIN_TOKEN_KEY = "zeptoStoreAdminToken";

let catalogData = {
    categories: [],
    products: []
};
let cart = {};
let selectedCategory = "All";
let searchQuery = "";
let currentUser = loadSavedUser();
let loadedOrders = [];
let orderHistoryPage = 1;
let hasMoreOrderHistory = false;

function loadSavedUser() {
    try {
        const saved = localStorage.getItem("zeptoUser");
        return saved ? JSON.parse(saved) : null;
    } catch (error) {
        console.error("Saved customer details could not be read.", error);
        return null;
    }
}

function money(amount) {
    const value = Number(amount);
    return `₹${value.toLocaleString("en-IN", {
        minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
        maximumFractionDigits: 2
    })}`;
}

async function apiRequest(path, options = {}, admin = false) {
    const headers = new Headers(options.headers || {});
    if (options.body) headers.set("Content-Type", "application/json");
    if (admin) {
        const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
        if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(path, { ...options, headers });
    const payload = await response.json();
    if (!response.ok) {
        const error = new Error(payload.error || "The request could not be completed.");
        error.status = response.status;
        throw error;
    }
    return payload;
}

async function initStore() {
    const status = document.getElementById("inventoryStatus");
    try {
        await refreshCatalog();
        renderCategories();
        renderProducts();
        renderCart();
        updateAccountButton();
        renderPaymentFields();
        status.textContent = "● Connected to this store's live inventory";
        status.className = "text-sm text-emerald-700 font-semibold";
    } catch (error) {
        console.error(error);
        status.textContent = "● Store inventory is unavailable";
        status.className = "text-sm text-red-600 font-semibold";
        document.getElementById("products").innerHTML = `
            <div class="col-span-full rounded-2xl bg-white p-8 text-center text-red-700">
                We could not connect to the store. Refresh the page or contact the shop.
            </div>
        `;
    }
}

async function refreshCatalog() {
    catalogData = await apiRequest("/api/catalog");
}

function renderCategories() {
    const categories = catalogData.categories.filter(
        (category) => category.name !== "All"
    );
    document.getElementById("categories").innerHTML = [
        { id: 0, name: "All", icon: "grid" },
        ...categories
    ].map((category) => `
        <button
            onclick="filterCategory(${JSON.stringify(category.name)})"
            class="px-4 py-3 rounded-2xl border whitespace-nowrap font-bold ${
                selectedCategory === category.name
                    ? "bg-purple-700 text-white border-purple-700"
                    : "bg-white border-slate-200 hover:bg-purple-50"
            }"
        >
            ${escapeHtml(category.name)}
        </button>
    `).join("");
}

function filterCategory(name) {
    selectedCategory = name;
    document.getElementById("activeCategory").textContent =
        name === "All" ? "All Categories" : name;
    renderCategories();
    renderProducts();
}

function renderProducts() {
    const products = catalogData.products.filter((product) => {
        const matchesCategory =
            selectedCategory === "All" || product.category === selectedCategory;
        const matchesSearch = product.name
            .toLowerCase()
            .includes(searchQuery.trim().toLowerCase());
        return matchesCategory && matchesSearch;
    });
    const grid = document.getElementById("products");
    document.getElementById("productTitle").textContent =
        selectedCategory === "All" ? "Available Products" : selectedCategory;

    if (!products.length) {
        grid.innerHTML = `
            <div class="col-span-full rounded-2xl bg-white p-10 text-center text-slate-500">
                ${catalogData.products.length
                    ? "No matching products found."
                    : "This store is preparing its online product catalogue. Please check back soon."
                }
            </div>
        `;
        return;
    }

    grid.innerHTML = products.map((product) => {
        const available = Math.max(0, product.available);
        const discount = product.mrp > product.price
            ? Math.round((1 - product.price / product.mrp) * 100)
            : 0;
        const quantity = cart[product.id] || 0;
        const stockClass = available === 0
            ? "stock-out"
            : available <= 3
                ? "stock-low"
                : "stock-ok";
        const stockText = available === 0
            ? "Out of stock"
            : available <= 3
                ? `Only ${available} left`
                : `${available} available`;

        return `
            <article class="product-card">
                <img
                    src="${escapeHtml(product.image)}"
                    class="product-img"
                    alt="${escapeHtml(product.name)}"
                    loading="lazy"
                >
                <div class="mt-3 text-xs text-slate-500">
                    ${escapeHtml(product.weight)}${product.rating ? ` · ⭐ ${escapeHtml(product.rating)}` : ""}
                </div>
                <h3 class="font-bold mt-1 min-h-10">${escapeHtml(product.name)}</h3>
                <div class="flex items-center gap-2 mt-2">
                    <b>${money(product.price)}</b>
                    ${discount ? `<s class="text-xs text-slate-400">${money(product.mrp)}</s>` : ""}
                    ${discount ? `<span class="text-xs text-emerald-700 font-bold">${discount}% off</span>` : ""}
                </div>
                <p class="${stockClass} mt-2">${stockText}</p>
                ${available === 0
                    ? `<button disabled class="w-full mt-3 py-2 rounded-xl bg-slate-200 text-slate-400 font-bold">Unavailable</button>`
                    : `<button onclick="addToCart(${product.id}, this)" class="w-full mt-3 py-2 rounded-xl bg-purple-700 text-white font-bold hover:bg-purple-800">${quantity ? "Add more" : "Add to cart"}</button>`
                }
            </article>
        `;
    }).join("");
    lucide.createIcons();
}

async function addToCart(productId, button) {
    if (button) button.disabled = true;
    try {
        await refreshCatalog();
        const product = catalogData.products.find((item) => item.id === productId);
        if (!product || (cart[productId] || 0) >= product.available) {
            alert(
                product
                    ? `Only ${Math.max(0, product.available)} unit(s) of ${product.name} are available.`
                    : "Product is not available."
            );
            renderProducts();
            renderCart();
            return;
        }
        cart[productId] = (cart[productId] || 0) + 1;
        renderProducts();
        renderCart();
    } catch (error) {
        showStoreError(error);
    } finally {
        if (button) button.disabled = false;
    }
}

async function changeQty(productId, delta) {
    if (delta > 0) {
        try {
            await refreshCatalog();
        } catch (error) {
            showStoreError(error);
            return;
        }
    }
    const nextQuantity = (cart[productId] || 0) + delta;
    if (nextQuantity <= 0) {
        delete cart[productId];
    } else {
        const product = catalogData.products.find((item) => item.id === productId);
        if (!product || nextQuantity > product.available) {
            alert(`Only ${product ? Math.max(0, product.available) : 0} unit(s) are available.`);
            return;
        }
        cart[productId] = nextQuantity;
    }
    renderProducts();
    renderCart();
}

function renderCart() {
    const container = document.getElementById("cartItems");
    const entries = Object.entries(cart);
    let subtotal = 0;
    let totalQuantity = 0;

    if (!entries.length) {
        container.innerHTML = `
            <div class="text-center text-slate-500 py-12">
                <i data-lucide="shopping-bag" class="mx-auto mb-3"></i>
                Your cart is empty.
            </div>
        `;
    } else {
        container.innerHTML = entries.map(([id, quantity]) => {
            const product = catalogData.products.find(
                (item) => item.id === Number(id)
            );
            if (!product) return "";
            subtotal += product.price * quantity;
            totalQuantity += quantity;
            return `
                <div class="flex gap-3 border rounded-2xl p-3">
                    <img src="${escapeHtml(product.image)}" class="w-16 h-16 rounded-xl object-cover" alt="">
                    <div class="flex-1">
                        <b class="text-sm">${escapeHtml(product.name)}</b>
                        <div class="text-xs text-slate-500">${money(product.price)} · ${product.available} available in store</div>
                        <div class="flex items-center gap-2 mt-2">
                            <button class="qty-btn" onclick="changeQty(${product.id}, -1)" aria-label="Remove one">−</button>
                            <b>${quantity}</b>
                            <button class="qty-btn" onclick="changeQty(${product.id}, 1)" aria-label="Add one">+</button>
                        </div>
                    </div>
                    <b>${money(product.price * quantity)}</b>
                </div>
            `;
        }).join("");
    }

    const delivery = subtotal ? DELIVERY_FEE : 0;
    document.getElementById("subtotal").textContent = money(subtotal);
    document.getElementById("deliveryFee").textContent = money(delivery);
    document.getElementById("grandTotal").textContent = money(subtotal + delivery);
    document.getElementById("cartBadge").textContent = `${totalQuantity} items`;
    document.getElementById("cartPrice").textContent = money(subtotal);
    lucide.createIcons();
}

function toggleCart(open) {
    document.getElementById("cartOverlay").classList.toggle("hidden", !open);
    document.getElementById("cartDrawer").classList.toggle("translate-x-full", !open);
    if (open) renderCart();
}

async function goToCheckout() {
    if (!Object.keys(cart).length) {
        alert("Add at least one available product first.");
        return;
    }

    const button = document.querySelector("#cartDrawer button[onclick='goToCheckout()']");
    button.disabled = true;
    try {
        await refreshCatalog();
        const unavailable = Object.entries(cart).flatMap(([id, quantity]) => {
            const product = catalogData.products.find((item) => item.id === Number(id));
            if (!product || product.available < quantity) {
                return [`${product ? product.name : "A product"}: only ${product ? product.available : 0} available`];
            }
            return [];
        });
        renderProducts();
        renderCart();
        if (unavailable.length) {
            alert(`Some items are no longer available:\n\n${unavailable.join("\n")}`);
            return;
        }
        toggleCart(false);
        openCheckout();
    } catch (error) {
        alert(error.message);
    } finally {
        button.disabled = false;
    }
}

function openCheckout() {
    if (currentUser) {
        document.getElementById("customerName").value = currentUser.name || "";
        document.getElementById("customerPhone").value = currentUser.phone || "";
    }
    updateCheckoutTotals();
    renderPaymentFields();
    hideCheckoutError();
    document.getElementById("checkoutModal").classList.remove("hidden");
}

function updateCheckoutTotals() {
    const subtotal = Object.entries(cart).reduce((total, [id, quantity]) => {
        const product = catalogData.products.find((item) => item.id === Number(id));
        return total + (product ? product.price * quantity : 0);
    }, 0);
    document.getElementById("checkoutSubtotal").textContent = money(subtotal);
    document.getElementById("checkoutTotal").textContent =
        money(subtotal + (subtotal ? DELIVERY_FEE : 0));
}

function renderPaymentFields() {
    const box = document.getElementById("paymentFields");
    if (!box) return;
    box.innerHTML = `
        <div class="bg-amber-50 text-amber-800 rounded-xl p-3 text-sm font-semibold">
            Cash is collected by the store when your order is delivered. Online payments are not connected yet.
        </div>
    `;
}

async function placeOrder() {
    hideCheckoutError();
    const customerName = document.getElementById("customerName").value.trim();
    const customerPhone = document.getElementById("customerPhone").value.trim();
    const address = document.getElementById("customerAddress").value.trim();
    const pincode = document.getElementById("customerPincode").value.trim();

    if (!customerName) return showCheckoutError("Enter your name.");
    if (!/^\d{10}$/.test(customerPhone)) {
        return showCheckoutError("Enter a valid 10-digit mobile number.");
    }
    if (!address) return showCheckoutError("Enter your delivery address.");
    if (!/^\d{6}$/.test(pincode)) {
        return showCheckoutError("Enter a valid 6-digit pincode.");
    }

    const button = document.querySelector("#checkoutModal button[onclick='placeOrder()']");
    button.disabled = true;
    button.textContent = "Checking stock and placing order...";
    try {
        const order = await apiRequest("/api/orders", {
            method: "POST",
            body: JSON.stringify({
                customerName,
                customerPhone,
                address,
                pincode,
                paymentMethod: "COD",
                items: Object.entries(cart).map(([productId, quantity]) => ({
                    productId: Number(productId),
                    quantity
                }))
            })
        });
        currentUser = { name: customerName, phone: customerPhone };
        localStorage.setItem("zeptoUser", JSON.stringify(currentUser));
        cart = {};
        await refreshCatalog();
        renderProducts();
        renderCart();
        updateAccountButton();
        closeModal("checkoutModal");
        document.getElementById("successText").textContent =
            `Order ${order.orderNumber} confirmed. Total ${money(order.total)}. Pay cash when the store delivers your order.`;
        document.getElementById("successModal").classList.remove("hidden");
        lucide.createIcons();
    } catch (error) {
        showCheckoutError(error.message);
        if (error.status === 409) {
            await refreshCatalog();
            renderProducts();
            renderCart();
        }
    } finally {
        button.disabled = false;
        button.textContent = "Place Order — Pay on Delivery";
    }
}

function showCheckoutError(message) {
    const alertBox = document.getElementById("checkoutInventoryAlert");
    alertBox.textContent = message;
    alertBox.classList.remove("hidden");
}

function hideCheckoutError() {
    document.getElementById("checkoutInventoryAlert").classList.add("hidden");
}

function openAuthModal() {
    if (currentUser) {
        document.getElementById("authName").value = currentUser.name || "";
        document.getElementById("authPhone").value = currentUser.phone || "";
    }
    document.getElementById("authError").textContent = "";
    document.getElementById("authModal").classList.remove("hidden");
}

function signIn() {
    const name = document.getElementById("authName").value.trim();
    const phone = document.getElementById("authPhone").value.trim();
    const error = document.getElementById("authError");
    if (!name) {
        error.textContent = "Enter your name.";
        return;
    }
    if (!/^\d{10}$/.test(phone)) {
        error.textContent = "Enter a valid 10-digit mobile number.";
        return;
    }
    currentUser = { name, phone };
    localStorage.setItem("zeptoUser", JSON.stringify(currentUser));
    updateAccountButton();
    closeModal("authModal");
}

function updateAccountButton() {
    const button = document.getElementById("accountButton");
    button.innerHTML = `
        <i data-lucide="user" class="w-5 h-5"></i>
        <span>${currentUser ? escapeHtml(currentUser.name) : "My details"}</span>
    `;
    lucide.createIcons();
}

function closeModal(id) {
    document.getElementById(id).classList.add("hidden");
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

function showStoreError(error) {
    alert(error.message || "The store could not complete that request.");
}

async function openStoreDashboard() {
    document.getElementById("storeDashboardModal").classList.remove("hidden");
    const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
    document.getElementById("storeLoginPanel").classList.toggle("hidden", Boolean(token));
    document.getElementById("storePanel").classList.toggle("hidden", !token);
    document.getElementById("storeLoginError").textContent = "";
    if (token) {
        try {
            await refreshCatalog();
            await refreshStoreDashboard();
        } catch (error) {
            document.getElementById("storeDashboardError").textContent = error.message;
        }
    }
}

async function loginStoreStaff(event) {
    event.preventDefault();
    const error = document.getElementById("storeLoginError");
    error.textContent = "";
    try {
        const result = await apiRequest("/api/admin/login", {
            method: "POST",
            body: JSON.stringify({
                password: document.getElementById("storePassword").value
            })
        });
        sessionStorage.setItem(ADMIN_TOKEN_KEY, result.token);
        document.getElementById("storePassword").value = "";
        document.getElementById("storeLoginPanel").classList.add("hidden");
        document.getElementById("storePanel").classList.remove("hidden");
        await refreshCatalog();
        await refreshStoreDashboard();
    } catch (loginError) {
        error.textContent = loginError.message;
    }
}

async function logoutStoreStaff() {
    try {
        await apiRequest("/api/admin/logout", { method: "POST" }, true);
    } catch (error) {
        console.error("Store dashboard sign-out failed.", error);
    }
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    document.getElementById("storeLoginPanel").classList.remove("hidden");
    document.getElementById("storePanel").classList.add("hidden");
}

async function refreshStoreDashboard() {
    try {
        const [inventory, orderData] = await Promise.all([
            apiRequest("/api/admin/inventory", {}, true),
            apiRequest("/api/admin/orders?page=1", {}, true)
        ]);
        renderAdminInventory(inventory);
        loadedOrders = [];
        orderHistoryPage = 1;
        appendOrderHistory(orderData);
        renderMovements(inventory.movements);
        document.getElementById("storeDashboardError").textContent = "";
    } catch (error) {
        if (error.status === 401) {
            logoutStoreStaff();
            document.getElementById("storeLoginError").textContent =
                "Your staff session expired. Sign in again.";
            return;
        }
        document.getElementById("storeDashboardError").textContent = error.message;
    }
}

async function loadOlderOrders() {
    const button = document.getElementById("loadOlderOrders");
    button.disabled = true;
    try {
        const nextPage = orderHistoryPage + 1;
        const result = await apiRequest(
            `/api/admin/orders?page=${nextPage}`,
            {},
            true
        );
        orderHistoryPage = nextPage;
        appendOrderHistory(result);
    } catch (error) {
        document.getElementById("storeDashboardError").textContent = error.message;
    } finally {
        button.disabled = false;
    }
}

function appendOrderHistory(result) {
    loadedOrders.push(...result.orders);
    hasMoreOrderHistory = result.hasMore;
    renderAdminOrders();
}

function filterOrderHistory() {
    renderAdminOrders();
}

function renderAdminInventory(data) {
    const select = document.getElementById("stockProduct");
    const previousValue = select.value;
    const categorySelect = document.getElementById("newProductCategory");
    if (!categorySelect.options.length) {
        categorySelect.innerHTML = catalogData.categories
            .filter((category) => category.name !== "All")
            .map((category) => `
                <option value="${category.id}">${escapeHtml(category.name)}</option>
            `).join("");
    }
    select.innerHTML = data.products.map((product) => `
        <option value="${product.id}">
            ${escapeHtml(product.name)} — ${product.available} available
        </option>
    `).join("");
    if (data.products.some((product) => String(product.id) === previousValue)) {
        select.value = previousValue;
    }
    document.getElementById("inventoryTable").innerHTML = data.products.map((product) => `
        <div class="flex justify-between gap-3 border-b py-2 text-sm">
            <span>${escapeHtml(product.name)}</span>
            <b>${product.available} available</b>
        </div>
    `).join("");
}

async function saveNewProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById("newProductMessage");
    message.textContent = "";
    try {
        const result = await apiRequest("/api/admin/products", {
            method: "POST",
            body: JSON.stringify({
                name: document.getElementById("newProductName").value.trim(),
                categoryId: Number(document.getElementById("newProductCategory").value),
                price: Number(document.getElementById("newProductPrice").value),
                mrp: Number(document.getElementById("newProductMrp").value),
                weight: document.getElementById("newProductWeight").value.trim(),
                stock: Number(document.getElementById("newProductStock").value),
                image: document.getElementById("newProductImage").value.trim()
            })
        }, true);
        message.textContent = `${result.name} added to the online catalogue.`;
        form.reset();
        document.getElementById("newProductStock").value = "0";
        await Promise.all([refreshStoreDashboard(), refreshCatalog()]);
        renderProducts();
        renderCart();
    } catch (error) {
        message.textContent = error.message;
    }
}

function renderMovements(movements) {
    const container = document.getElementById("inventoryMovements");
    container.innerHTML = movements.length
        ? movements.map((movement) => `
            <div class="border-b py-2 text-xs">
                <b>${escapeHtml(movement.name)}</b> · ${escapeHtml(movement.movement_type)}
                · ${movement.quantity_change > 0 ? "+" : ""}${movement.quantity_change}
                · now ${movement.stock_after}
                ${movement.reason ? `· ${escapeHtml(movement.reason)}` : ""}
                <div class="text-slate-500">${escapeHtml(movement.created_at)}</div>
            </div>
        `).join("")
        : `<p class="text-sm text-slate-500">No stock changes have been recorded yet.</p>`;
}

async function saveStockAdjustment(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById("stockMessage");
    message.textContent = "";
    try {
        const result = await apiRequest("/api/admin/inventory/adjust", {
            method: "POST",
            body: JSON.stringify({
                productId: Number(document.getElementById("stockProduct").value),
                action: document.getElementById("stockAction").value,
                quantity: Number(document.getElementById("stockQuantity").value),
                reason: document.getElementById("stockReason").value.trim()
            })
        }, true);
        message.textContent =
            `${result.productName}: ${result.available} unit(s) available online.`;
        form.reset();
        await Promise.all([refreshStoreDashboard(), refreshCatalog()]);
        renderProducts();
        renderCart();
    } catch (error) {
        message.textContent = error.message;
    }
}

function renderAdminOrders() {
    const container = document.getElementById("storeOrders");
    const statusFilter = document.getElementById("orderStatusFilter").value;
    const search = document.getElementById("orderHistorySearch").value.trim().toLowerCase();
    const filteredOrders = loadedOrders.filter((order) => {
        const statusMatches =
            statusFilter === "ALL" ||
            (statusFilter === "ACTIVE"
                ? ["PLACED", "PREPARING", "OUT_FOR_DELIVERY"].includes(order.status)
                : order.status === statusFilter);
        const searchText = [
            order.order_number,
            order.customer_name,
            order.customer_phone,
            order.address,
            ...order.items.map((item) => item.name)
        ].join(" ").toLowerCase();
        return statusMatches && searchText.includes(search);
    });
    document.getElementById("orderHistorySummary").textContent =
        `Showing ${filteredOrders.length} of ${loadedOrders.length} loaded orders` +
        (hasMoreOrderHistory ? " · more history available" : "");
    document.getElementById("loadOlderOrders").classList.toggle(
        "hidden",
        !hasMoreOrderHistory
    );

    if (!loadedOrders.length) {
        container.innerHTML = `
            <p class="rounded-xl border bg-slate-50 p-5 text-sm text-slate-600">
                No orders yet. New customer orders will appear here and remain in history.
            </p>
        `;
        return;
    }

    if (!filteredOrders.length) {
        container.innerHTML = `
            <p class="rounded-xl border bg-slate-50 p-5 text-sm text-slate-600">
                No orders match these filters.
            </p>
        `;
        return;
    }

    const statusNames = {
        PLACED: "New",
        PREPARING: "Preparing",
        OUT_FOR_DELIVERY: "Out for delivery",
        DELIVERED: "Delivered",
        CANCELLED: "Cancelled"
    };
    container.innerHTML = filteredOrders.map((order) => {
        const steps = ["PLACED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"];
        const currentStep = steps.indexOf(order.status);
        const options = order.status === "CANCELLED"
            ? ["CANCELLED"]
            : [
                ...steps.slice(Math.max(0, currentStep), currentStep + 2),
                ...(order.status === "DELIVERED" ? [] : ["CANCELLED"])
            ];
        const orderDate = new Date(`${order.created_at.replace(" ", "T")}Z`);
        const displayedDate = Number.isNaN(orderDate.getTime())
            ? order.created_at
            : orderDate.toLocaleString();
        return `
            <article class="rounded-xl border bg-white p-4">
                <div class="flex flex-wrap justify-between items-start gap-3">
                    <div>
                        <b class="text-base">${escapeHtml(order.order_number)}</b>
                        <p class="text-xs text-slate-500 mt-1">${escapeHtml(displayedDate)}</p>
                    </div>
                    <span class="rounded-full bg-purple-50 px-3 py-1 text-xs font-bold text-purple-800">
                        ${statusNames[order.status] || escapeHtml(order.status)}
                    </span>
                </div>
                <div class="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                        <b class="text-sm">${escapeHtml(order.customer_name)}</b>
                        <p class="text-sm text-slate-600">${escapeHtml(order.customer_phone)}</p>
                        <p class="text-xs text-slate-600">${escapeHtml(order.address)}, ${escapeHtml(order.pincode)}</p>
                    </div>
                    <div class="rounded-lg bg-slate-50 p-3">
                        <b class="text-xs uppercase tracking-wide text-slate-500">Products ordered</b>
                        <ul class="mt-2 space-y-1">
                            ${order.items.map((item) => `
                                <li class="flex justify-between gap-3 text-sm">
                                    <span>${escapeHtml(item.name)} × ${item.quantity}</span>
                                    <span>${money(item.unit_price * item.quantity)}</span>
                                </li>
                            `).join("")}
                        </ul>
                    </div>
                </div>
                <div class="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                    <p class="text-sm font-bold">
                        Total ${money(order.total)} · ${escapeHtml(order.payment_method)}
                    </p>
                    <select
                        class="field max-w-52"
                        aria-label="Update order ${escapeHtml(order.order_number)} status"
                        onchange="changeOrderStatus(${order.id}, this.value)">
                        ${options.map((status) => `
                            <option value="${status}" ${status === order.status ? "selected" : ""}>
                                ${statusNames[status]}
                            </option>
                        `).join("")}
                    </select>
                </div>
            </article>
        `;
    }).join("");
}

async function changeOrderStatus(orderId, status) {
    try {
        await apiRequest(`/api/admin/orders/${orderId}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status })
        }, true);
        await refreshStoreDashboard();
    } catch (error) {
        document.getElementById("storeDashboardError").textContent = error.message;
        await refreshStoreDashboard();
    }
}

document.getElementById("searchInput").addEventListener("input", (event) => {
    searchQuery = event.target.value;
    renderProducts();
});

document.getElementById("orderHistorySearch").addEventListener(
    "input",
    filterOrderHistory
);
document.getElementById("orderStatusFilter").addEventListener(
    "change",
    filterOrderHistory
);
document.getElementById("storeLoginForm").addEventListener("submit", loginStoreStaff);
document.getElementById("stockAdjustmentForm").addEventListener("submit", saveStockAdjustment);
document.getElementById("newProductForm").addEventListener("submit", saveNewProduct);

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeModal("authModal");
        closeModal("checkoutModal");
        closeModal("successModal");
        closeModal("storeDashboardModal");
        toggleCart(false);
    }
});

window.addEventListener("load", initStore);

window.setInterval(async () => {
    try {
        await refreshCatalog();
        renderProducts();
        renderCart();
        document.getElementById("inventoryStatus").textContent =
            "● Connected to this store's live inventory";
        document.getElementById("inventoryStatus").className =
            "text-sm text-emerald-700 font-semibold";
    } catch (error) {
        console.error("Store inventory refresh failed.", error);
        document.getElementById("inventoryStatus").textContent =
            "● Store inventory connection lost";
        document.getElementById("inventoryStatus").className =
            "text-sm text-red-600 font-semibold";
    }
}, 30000);
