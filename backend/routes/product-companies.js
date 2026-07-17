// ===== PRODUCT: COMPANIES & CUSTOMERS MODULE =====
// GET    /api/product/companies           - List companies (with customer + insight counts)
// POST   /api/product/companies           - Create company
// PUT    /api/product/companies/:id       - Update company
// DELETE /api/product/companies/:id       - Delete company (detaches customers)
// GET    /api/product/customers           - List customers (with company info)
// POST   /api/product/customers           - Create customer
// PUT    /api/product/customers/:id       - Update customer
// DELETE /api/product/customers/:id       - Delete customer (detaches insights)
//
// Company tiers weight the user-impact score on features:
// strategic=3, growth=2, standard=1 (see product-features.js).

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, queryAll, queryOne, run } = require('../database');
const { requireAuth } = require('../middleware/auth');
const { serverError } = require('../utils/errors');

const router = express.Router();

const COMPANY_TIERS = ['strategic', 'growth', 'standard'];

// GET /api/product/companies
router.get('/product/companies', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const companies = await queryAll(db,
      `SELECT c.*,
         (SELECT COUNT(*) FROM pb_customers cu WHERE cu.company_id = c.id) as customer_count,
         (SELECT COUNT(*) FROM pb_insights i JOIN pb_customers cu2 ON i.customer_id = cu2.id WHERE cu2.company_id = c.id) as insight_count
       FROM pb_companies c
       ORDER BY CASE c.tier WHEN 'strategic' THEN 0 WHEN 'growth' THEN 1 ELSE 2 END, c.name`);
    res.json(companies);
  } catch (e) { serverError(res, e); }
});

// POST /api/product/companies
router.post('/product/companies', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { name, tier, arr, notes } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    if (tier && !COMPANY_TIERS.includes(tier)) return res.status(400).json({ error: 'invalid tier' });

    const id = uuidv4();
    await run(db, 'INSERT INTO pb_companies (id, name, tier, arr, notes) VALUES (?, ?, ?, ?, ?)',
      [id, name.trim(), tier || 'standard', arr ?? null, notes || null]);
    const company = await queryOne(db, 'SELECT * FROM pb_companies WHERE id = ?', [id]);
    res.status(201).json(company);
  } catch (e) { serverError(res, e); }
});

// PUT /api/product/companies/:id
router.put('/product/companies/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT * FROM pb_companies WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Company not found' });

    const { name, tier, arr, notes } = req.body;
    if (tier !== undefined && !COMPANY_TIERS.includes(tier)) return res.status(400).json({ error: 'invalid tier' });

    await run(db, 'UPDATE pb_companies SET name = ?, tier = ?, arr = ?, notes = ? WHERE id = ?',
      [name !== undefined ? name : existing.name,
       tier !== undefined ? tier : existing.tier,
       arr !== undefined ? arr : existing.arr,
       notes !== undefined ? notes : existing.notes,
       req.params.id]);
    const company = await queryOne(db, 'SELECT * FROM pb_companies WHERE id = ?', [req.params.id]);
    res.json(company);
  } catch (e) { serverError(res, e); }
});

// DELETE /api/product/companies/:id
router.delete('/product/companies/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'UPDATE pb_customers SET company_id = NULL WHERE company_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM pb_companies WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

// GET /api/product/customers
router.get('/product/customers', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const customers = await queryAll(db,
      `SELECT cu.*, c.name as company_name, c.tier as company_tier,
         (SELECT COUNT(*) FROM pb_insights i WHERE i.customer_id = cu.id) as insight_count
       FROM pb_customers cu
       LEFT JOIN pb_companies c ON cu.company_id = c.id
       ORDER BY cu.name`);
    res.json(customers);
  } catch (e) { serverError(res, e); }
});

// POST /api/product/customers
router.post('/product/customers', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const { name, email, company_id } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    if (company_id) {
      const company = await queryOne(db, 'SELECT id FROM pb_companies WHERE id = ?', [company_id]);
      if (!company) return res.status(404).json({ error: 'Company not found' });
    }

    const id = uuidv4();
    await run(db, 'INSERT INTO pb_customers (id, name, email, company_id) VALUES (?, ?, ?, ?)',
      [id, name.trim(), email || null, company_id || null]);
    const customer = await queryOne(db,
      `SELECT cu.*, c.name as company_name, c.tier as company_tier
       FROM pb_customers cu LEFT JOIN pb_companies c ON cu.company_id = c.id
       WHERE cu.id = ?`, [id]);
    res.status(201).json(customer);
  } catch (e) { serverError(res, e); }
});

// PUT /api/product/customers/:id
router.put('/product/customers/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const existing = await queryOne(db, 'SELECT * FROM pb_customers WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Customer not found' });

    const { name, email, company_id } = req.body;
    if (company_id) {
      const company = await queryOne(db, 'SELECT id FROM pb_companies WHERE id = ?', [company_id]);
      if (!company) return res.status(404).json({ error: 'Company not found' });
    }

    await run(db, 'UPDATE pb_customers SET name = ?, email = ?, company_id = ? WHERE id = ?',
      [name !== undefined ? name : existing.name,
       email !== undefined ? email : existing.email,
       company_id !== undefined ? company_id : existing.company_id,
       req.params.id]);
    const customer = await queryOne(db,
      `SELECT cu.*, c.name as company_name, c.tier as company_tier
       FROM pb_customers cu LEFT JOIN pb_companies c ON cu.company_id = c.id
       WHERE cu.id = ?`, [req.params.id]);
    res.json(customer);
  } catch (e) { serverError(res, e); }
});

// DELETE /api/product/customers/:id
router.delete('/product/customers/:id', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    await run(db, 'UPDATE pb_insights SET customer_id = NULL WHERE customer_id = ?', [req.params.id]);
    await run(db, 'DELETE FROM pb_customers WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { serverError(res, e); }
});

module.exports = router;
