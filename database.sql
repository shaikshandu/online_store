/* =====================================================
   DATABASE RESET
===================================================== */

PRAGMA foreign_keys = ON;


DROP TABLE IF EXISTS order_items;

DROP TABLE IF EXISTS orders;

DROP TABLE IF EXISTS inventory;

DROP TABLE IF EXISTS products;

DROP TABLE IF EXISTS categories;



/* =====================================================
   CATEGORIES
===================================================== */

CREATE TABLE categories (

    id INTEGER PRIMARY KEY,

    name TEXT NOT NULL UNIQUE,

    icon TEXT NOT NULL

);



/* =====================================================
   PRODUCTS
===================================================== */

CREATE TABLE products (

    id INTEGER PRIMARY KEY,

    name TEXT NOT NULL,

    category_id INTEGER NOT NULL,

    price INTEGER NOT NULL,

    mrp INTEGER NOT NULL,

    weight TEXT NOT NULL,

    image TEXT NOT NULL,

    rating REAL NOT NULL,

    FOREIGN KEY(category_id)
        REFERENCES categories(id)

);



/* =====================================================
   OFFLINE INVENTORY
===================================================== */

CREATE TABLE inventory (

    product_id INTEGER PRIMARY KEY,

    stock INTEGER NOT NULL DEFAULT 0
        CHECK(stock >= 0),

    reserved INTEGER NOT NULL DEFAULT 0
        CHECK(reserved >= 0),

    updated_at
        TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY(product_id)
        REFERENCES products(id)

);



/* =====================================================
   ORDERS
===================================================== */

CREATE TABLE orders (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    order_number TEXT NOT NULL UNIQUE,

    customer_name TEXT NOT NULL,

    customer_phone TEXT NOT NULL,

    address TEXT NOT NULL,

    payment_method TEXT NOT NULL,

    status TEXT NOT NULL,

    total INTEGER NOT NULL,

    created_at
        TEXT DEFAULT CURRENT_TIMESTAMP

);



/* =====================================================
   ORDER ITEMS
===================================================== */

CREATE TABLE order_items (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    order_id INTEGER NOT NULL,

    product_id INTEGER NOT NULL,

    quantity INTEGER NOT NULL,

    unit_price INTEGER NOT NULL,

    FOREIGN KEY(order_id)
        REFERENCES orders(id),

    FOREIGN KEY(product_id)
        REFERENCES products(id)

);



/* =====================================================
   CATEGORIES DATA
===================================================== */

INSERT INTO categories
VALUES

(1, 'All', 'grid'),

(2, 'Fruits & Vegetables', 'apple'),

(3, 'Dairy & Breakfast', 'milk'),

(4, 'Munchies', 'cookie'),

(5, 'Instant Food', 'flame'),

(6, 'Beverages', 'coffee'),

(7, 'Personal Care', 'smile');



/* =====================================================
   PRODUCTS
===================================================== */

INSERT INTO products
VALUES

(
    1,
    'Fresh Farm Milk (500ml)',
    3,
    32,
    35,
    '500 ml',
    'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=300&q=80',
    4.8
),

(
    2,
    'Organic Bananas (6 pcs)',
    2,
    45,
    60,
    '6 pcs',
    'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=300&q=80',
    4.7
),

(
    3,
    'Fresh Alphonso Mango (1kg)',
    2,
    199,
    299,
    '1 kg',
    'https://images.unsplash.com/photo-1553279768-865429fa0078?auto=format&fit=crop&w=300&q=80',
    4.9
),

(
    4,
    'Fresh Tomatoes (500g)',
    2,
    24,
    35,
    '500 g',
    'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=300&q=80',
    4.6
),

(
    5,
    'Fresh Onions (1kg)',
    2,
    38,
    50,
    '1 kg',
    'https://images.unsplash.com/photo-1618512496248-a078c1ae9a89?auto=format&fit=crop&w=300&q=80',
    4.5
),

(
    6,
    'Amul Butter (500g)',
    3,
    275,
    280,
    '500 g',
    'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?auto=format&fit=crop&w=300&q=80',
    4.9
),

(
    7,
    'Brown Bread (400g)',
    3,
    40,
    45,
    '400 g',
    'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=300&q=80',
    4.7
),

(
    8,
    'Fresh Paneer (200g)',
    3,
    90,
    110,
    '200 g',
    'https://images.unsplash.com/photo-1631379578550-7038263db699?auto=format&fit=crop&w=300&q=80',
    4.8
),

(
    9,
    'Classic Curd (400g)',
    3,
    35,
    40,
    '400 g',
    'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=300&q=80',
    4.6
),

(
    10,
    'Lays Magic Masala Chips',
    4,
    20,
    20,
    '50 g',
    'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=300&q=80',
    4.9
),

(
    11,
    'Kurkure Masala Munch',
    4,
    20,
    20,
    '90 g',
    'https://images.unsplash.com/photo-1621939514649-280e2ee25f60?auto=format&fit=crop&w=300&q=80',
    4.7
),

(
    12,
    'Cadbury Dairy Silk Chocolate',
    4,
    175,
    190,
    '150 g',
    'https://images.unsplash.com/photo-1549007994-cb92caebd54b?auto=format&fit=crop&w=300&q=80',
    4.9
),

(
    13,
    'Haldiram Nagpur Bhujia',
    4,
    52,
    60,
    '400 g',
    'https://images.unsplash.com/photo-1599488615731-7e5c2823ff26?auto=format&fit=crop&w=300&q=80',
    4.8
),

(
    14,
    'Maggi 2-Minute Noodles',
    5,
    14,
    14,
    '70 g',
    'https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?auto=format&fit=crop&w=300&q=80',
    4.9
),

(
    15,
    'Yippee Noodles Masala',
    5,
    25,
    30,
    '120 g',
    'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=300&q=80',
    4.6
),

(
    16,
    'Knorr Hot & Sour Soup',
    5,
    55,
    60,
    '43 g',
    'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=300&q=80',
    4.5
),

(
    17,
    'Coca-Cola Cold Drink (750ml)',
    6,
    45,
    50,
    '750 ml',
    'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=300&q=80',
    4.8
),

(
    18,
    'Red Bull Energy Drink',
    6,
    125,
    135,
    '250 ml',
    'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=300&q=80',
    4.7
),

(
    19,
    'Tropicana Orange Juice',
    6,
    120,
    140,
    '1 L',
    'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=300&q=80',
    4.6
),

(
    20,
    'Bisleri Mineral Water (1L)',
    6,
    20,
    20,
    '1 L',
    'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?auto=format&fit=crop&w=300&q=80',
    4.9
),

(
    21,
    'Colgate Strong Teeth Toothpaste',
    7,
    95,
    105,
    '150 g',
    'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=300&q=80',
    4.8
),

(
    22,
    'Dove Beauty Bath Soap',
    7,
    58,
    65,
    '100 g',
    'https://images.unsplash.com/photo-1607006318939-2a148c242f36?auto=format&fit=crop&w=300&q=80',
    4.7
),

(
    23,
    'Nivea Soft Moisturizer',
    7,
    160,
    190,
    '100 ml',
    'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=300&q=80',
    4.8
);



/* =====================================================
   OFFLINE STOCK
===================================================== */

/*
    stock = physical quantity available

    reserved = quantity temporarily reserved

    available stock =
        stock - reserved
*/


INSERT INTO inventory
(
    product_id,
    stock,
    reserved
)

VALUES

(1, 12, 0),

(2, 20, 0),

(3, 0, 0),

(4, 15, 0),

(5, 8, 0),

(6, 4, 0),

(7, 10, 0),

(8, 0, 0),

(9, 7, 0),

(10, 30, 0),

(11, 3, 0),

(12, 6, 0),

(13, 9, 0),

(14, 25, 0),

(15, 12, 0),

(16, 2, 0),

(17, 14, 0),

(18, 0, 0),

(19, 5, 0),

(20, 25, 0),

(21, 11, 0),

(22, 4, 0),

(23, 8, 0);