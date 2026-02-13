const express = require("express");
const session = require("express-session");
const mysql = require('mysql2');
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

// ======================== DATABASE CLASS ========================
class Database {
    constructor() {
        this.pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'gediyon16',
            password: process.env.DB_PASSWORD || 'gediyon16',
            database: process.env.DB_NAME || 'gediyon16',
            port: process.env.DB_PORT || 3306,
            connectionLimit: 10,
        });
        this.testConnection();
    }

    testConnection() {
        this.pool.getConnection((err, connection) => {
            if (err) {
                console.error('❌ Database Connection Error:', err.message);
                return;
            }
            console.log('✅ Hadiya Transport Database Connected Successfully!');
            connection.release();
        });
    }

    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.pool.query(sql, params, (err, results) => {
                if (err) reject(err);
                else resolve({ id: results.insertId, changes: results.affectedRows });
            });
        });
    }

    async all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.pool.query(sql, params, (err, results) => {
                if (err) reject(err);
                else resolve(results);
            });
        });
    }

    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.pool.query(sql, params, (err, results) => {
                if (err) reject(err);
                else resolve(results[0]);
            });
        });
    }
}

// ======================== FILE UPLOAD SERVICE ========================
class UploadService {
    constructor() {
        this.storage = multer.diskStorage({
            destination: (req, file, cb) => {
                let uploadDir = './public/uploads';
                const imageFields = ['leader_image', 'service_icon', 'photo', 'image'];
                const mediaFields = ['news_image', 'announcement_attachment', 'attachment', 'file'];

                // Special-case: treat uploads from the admin news routes as media
                // so news featured images are stored under /uploads/media.
                const isNewsRoute = typeof req.originalUrl === 'string' && req.originalUrl.includes('/admin/news');

                if (imageFields.includes(file.fieldname) && !isNewsRoute) {
                    uploadDir = './public/uploads/images';
                } else if (mediaFields.includes(file.fieldname) || (file.fieldname === 'image' && isNewsRoute)) {
                    uploadDir = './public/uploads/media';
                }

                if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
                cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const ext = path.extname(file.originalname);
                cb(null, file.fieldname + '-' + uniqueSuffix + ext);
            }
        });

        this.upload = multer({
            storage: this.storage,
            limits: { fileSize: 20 * 1024 * 1024 },
            fileFilter: (req, file, cb) => {
                const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|mp4|mov/;
                const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
                const mimetype = allowedTypes.test(file.mimetype);
                if (mimetype && extname) return cb(null, true);
                cb(new Error('Only images, PDFs, and videos are allowed'));
            }
        });

        // Ensure directories exist
        ['./public/uploads', './public/uploads/images', './public/uploads/media'].forEach(dir => {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        }); 
    }

    single(fieldname) {
        return this.upload.single(fieldname);
    }

    fields(fieldsArray) {
        return this.upload.fields(fieldsArray);
    }
}

// ======================== AUTH SERVICE ========================
class AuthService {
    constructor(db) {
        this.db = db;
    }

    async validateAdmin(username, password) {
        const admin = await this.db.get("SELECT * FROM admin_users WHERE username = ? AND is_active = 1", [username]);
        if (admin && await bcrypt.compare(password, admin.password)) return admin;
        return null;
    }

    async updateLastLogin(adminId) {
        await this.db.run("UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", [adminId]);
    }

    requireAdmin = (req, res, next) => {
        if (req.session.admin) return next();
        res.redirect('/admin');
    }

    requireAuth = (req, res, next) => {
        if (req.session.user || req.session.admin) return next();
        res.redirect('/admin');
    }
}

// ======================== ADMIN CONTROLLER ========================
class AdminController {
    constructor(db, uploadService, authService) {
        this.db = db;
        this.upload = uploadService;
        this.auth = authService;
    }

    // ---------- DASHBOARD ----------
    async dashboard(req, res) {
        try {
            const stats = (await this.db.all(`
                SELECT 
                    (SELECT COUNT(*) FROM leaders) as total_leaders,
                    (SELECT COUNT(*) FROM services) as total_services,
                    (SELECT COUNT(*) FROM news) as total_news,
                    (SELECT COUNT(*) FROM announcements) as total_announcements,
                    (SELECT COUNT(*) FROM contact_messages WHERE is_read = 0) as unread_messages,
                    (SELECT COUNT(*) FROM admin_users) as total_admins
            `))[0];
            const recentMessages = await this.db.all("SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 5");
            const recentNews = await this.db.all("SELECT * FROM news ORDER BY created_at DESC LIMIT 5");
            res.send(this.renderDashboard(stats, recentMessages, recentNews, req.session.admin));
        } catch (error) {
            console.error("Admin dashboard error:", error);
            res.status(500).send("Error loading dashboard: " + error.message);
        }
    }

    renderDashboard(stat, messages, news, admin) {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Admin Dashboard - Hadiya Transport</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', sans-serif; background: #f5f7fa; }
                .admin-container { display: flex; min-height: 100vh; }
                .sidebar { width: 280px; background: linear-gradient(135deg, #061e29, #0a2a38); color: white; padding: 30px 20px; }
                .sidebar h2 { display: flex; align-items: center; gap: 10px; margin-bottom: 40px; font-size: 1.5rem; }
                .sidebar h2 i { color: #e4ff30; }
                .sidebar nav { display: flex; flex-direction: column; gap: 10px; }
                .sidebar nav a { color: rgba(255,255,255,0.8); text-decoration: none; padding: 12px 15px; border-radius: 8px; display: flex; align-items: center; gap: 12px; transition: all 0.3s ease; }
                .sidebar nav a:hover, .sidebar nav a.active { background: rgba(255,255,255,0.1); color: white; }
                .main-content { flex: 1; padding: 30px; }
                .admin-header { background: white; padding: 20px 30px; border-radius: 15px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; }
                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 25px; margin-bottom: 40px; }
                .stat-card { background: white; padding: 25px; border-radius: 15px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); display: flex; align-items: center; gap: 20px; }
                .stat-icon { width: 60px; height: 60px; background: linear-gradient(135deg, #1e78ff, #061e29); border-radius: 12px; display: flex; align-items: center; justify-content: center; }
                .stat-icon i { font-size: 1.8rem; color: white; }
                .stat-content h3 { font-size: 1.8rem; margin-bottom: 5px; color: #061e29; }
                .admin-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 25px; }
                .admin-card { background: white; padding: 25px; border-radius: 15px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
                .quick-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 20px; }
                .action-btn { padding: 15px; background: #f8f9fa; border-radius: 10px; text-align: center; text-decoration: none; color: #061e29; transition: all 0.3s ease; }
                .action-btn:hover { background: #1e78ff; color: white; }
                .message-item, .news-item { display: flex; justify-content: space-between; align-items: center; padding: 15px 0; border-bottom: 1px solid #eee; }
                .badge { background: #e4ff30; color: #061e29; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; margin-left: 10px; }
                .user-info { display: flex; align-items: center; gap: 20px; }
                .user-badge { background: #061e29; color: white; padding: 8px 15px; border-radius: 20px; }
            </style>
        </head>
        <body>
            <div class="admin-container">
                <div class="sidebar">
                    <h2><i class="fas fa-bus"></i> Hadiya Transport</h2>
                    <nav>
                        <a href="/admin/dashboard" class="active"><i class="fas fa-tachometer-alt"></i> Dashboard</a>
                        <a href="/admin/statistics"><i class="fas fa-chart-bar"></i> Statistics</a>
                        <a href="/admin/leaders"><i class="fas fa-users"></i> Leadership</a>
                        <a href="/admin/services"><i class="fas fa-cogs"></i> Services</a>
                        <a href="/admin/news"><i class="fas fa-newspaper"></i> News</a>
                        <a href="/admin/announcements"><i class="fas fa-bullhorn"></i> Announcements</a>
                        <a href="/admin/messages"><i class="fas fa-envelope"></i> Messages ${stat.unread_messages > 0 ? `<span style="background: #e4ff30; color: #061e29; padding: 2px 8px; border-radius: 20px; margin-left: auto;">${stat.unread_messages}</span>` : ''}</a>
                        <a href="/admin/profile"><i class="fas fa-user-circle"></i> My Profile</a>
                        <a href="/admin/settings"><i class="fas fa-cog"></i> Settings</a>
                        <a href="/admin/logout"><i class="fas fa-sign-out-alt"></i> Logout</a>
                    </nav>
                </div>
                <div class="main-content">
                    <div class="admin-header">
                        <div><h1>Dashboard</h1><p>Welcome back, ${this.escapeHtml(admin.full_name || 'Admin')}</p></div>
                        <div class="user-info">
                            <div class="user-badge"><i class="fas fa-user-shield"></i> ${this.escapeHtml(admin.role || 'Admin')}</div>
                            <a href="/" target="_blank" style="color: #1e78ff; text-decoration: none;"><i class="fas fa-external-link-alt"></i> View Site</a>
                        </div>
                    </div>
                    <div class="stats-grid">
                        <div class="stat-card"><div class="stat-icon"><i class="fas fa-users"></i></div><div class="stat-content"><h3>${stat.total_leaders || 0}</h3><p>Leadership</p></div></div>
                        <div class="stat-card"><div class="stat-icon"><i class="fas fa-cogs"></i></div><div class="stat-content"><h3>${stat.total_services || 0}</h3><p>Services</p></div></div>
                        <div class="stat-card"><div class="stat-icon"><i class="fas fa-newspaper"></i></div><div class="stat-content"><h3>${stat.total_news || 0}</h3><p>News Articles</p></div></div>
                        <div class="stat-card"><div class="stat-icon"><i class="fas fa-bullhorn"></i></div><div class="stat-content"><h3>${stat.total_announcements || 0}</h3><p>Announcements</p></div></div>
                    </div>
                    <div style="margin-bottom: 30px;">
                        <div class="quick-actions">
                            <a href="/admin/leaders?action=add" class="action-btn"><i class="fas fa-user-plus"></i> Add Leader</a>
                            <a href="/admin/services?action=add" class="action-btn"><i class="fas fa-plus-circle"></i> Add Service</a>
                            <a href="/admin/news?action=add" class="action-btn"><i class="fas fa-plus-square"></i> Add News</a>
                            <a href="/admin/announcements?action=add" class="action-btn"><i class="fas fa-plus"></i> Add Announcement</a>
                        </div>
                    </div>
                    <div class="admin-grid">
                        <div class="admin-card">
                            <div class="card-header"><h2><i class="fas fa-envelope"></i> Recent Messages</h2><a href="/admin/messages" class="view-all">View All</a></div>
                            ${messages.length > 0 ? messages.map(m => `
                                <div class="message-item">
                                    <div><h4>${this.escapeHtml(m.first_name)} ${this.escapeHtml(m.last_name)}</h4><p>${this.escapeHtml(m.subject || 'No subject')}</p><small>${new Date(m.created_at).toLocaleDateString()}</small></div>
                                    <div>${m.is_read ? '' : '<span class="badge">New</span>'}<a href="/admin/messages/${m.id}" style="color: #1e78ff; margin-left: 10px;">View</a></div>
                                </div>
                            `).join('') : '<p style="color: #666; text-align: center; padding: 20px;">No messages yet.</p>'}
                        </div>
                        <div class="admin-card">
                            <div class="card-header"><h2><i class="fas fa-newspaper"></i> Recent News</h2><a href="/admin/news" class="view-all">View All</a></div>
                            ${news.length > 0 ? news.map(n => `
                                <div class="news-item">
                                    <div><h4>${this.escapeHtml(n.title_en.substring(0, 50))}${n.title_en.length > 50 ? '...' : ''}</h4><small>${new Date(n.created_at).toLocaleDateString()}</small></div>
                                    <a href="/admin/news/edit/${n.id}" style="color: #1e78ff;">Edit</a>
                                </div>
                            `).join('') : '<p style="color: #666; text-align: center; padding: 20px;">No news articles yet.</p>'}
                        </div>
                    </div>
                </div>
            </div>
        </body>
        </html>`;
    }

    // ---------- LEADERS ----------
    async listLeaders(req, res) {
        try {
            const leaders = await this.db.all("SELECT * FROM leaders ORDER BY display_order");
            const action = req.query.action;
            res.send(this.renderLeaders(leaders, action, req.query));
        } catch (error) {
            console.error("Leaders management error:", error);
            res.status(500).send("Error loading leaders management");
        }
    }

    renderLeaders(leaders, action, query = {}) {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Leadership Management - Hadiya Transport</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', sans-serif; background: #f5f7fa; padding: 30px; }
                .container { max-width: 1200px; margin: 0 auto; }
                .back-link { display: inline-block; margin-bottom: 20px; color: #1e78ff; text-decoration: none; }
                .card { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                h1 { color: #061e29; margin-bottom: 20px; }
                .btn { display: inline-block; padding: 12px 25px; background: #1e78ff; color: white; text-decoration: none; border-radius: 8px; border: none; cursor: pointer; font-size: 16px; }
                .btn-sm { padding: 6px 12px; font-size: 14px; }
                .btn-danger { background: #dc2626; }
                .table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                .table th, .table td { padding: 15px; text-align: left; border-bottom: 1px solid #eee; }
                .table th { background: #f8fafc; font-weight: 600; color: #333; }
                .form-group { margin-bottom: 20px; }
                label { display: block; margin-bottom: 8px; font-weight: 600; color: #333; }
                input, textarea, select { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; }
                .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                .alert { padding: 15px; border-radius: 8px; margin-bottom: 20px; }
                .alert-success { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
                .alert-error { background: #fee2e2; color: #dc2626; border: 1px solid #fecaca; }
            </style>
        </head>
        <body>
            <div class="container">
                <a href="/admin/dashboard" class="back-link">← Back to Dashboard</a>
                ${query.success ? `<div class="alert alert-success">${this.escapeHtml(query.success)}</div>` : ''}
                ${query.error ? `<div class="alert alert-error">${this.escapeHtml(query.error)}</div>` : ''}
                <div class="card">
                    <h1><i class="fas fa-users"></i> Leadership Management</h1>
                    ${action === 'add' ? this.renderAddLeaderForm() : `
                        <a href="/admin/leaders?action=add" class="btn" style="margin-bottom: 20px;"><i class="fas fa-plus"></i> Add New Leader</a>
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Image</th>
                                    <th>Name</th>
                                    <th>Title (EN)</th>
                                    <th>Phone</th>
                                    <th>Order</th>
                                    <th>Active</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${leaders.map(l => `
                                    <tr>
                                        <td>${l.image_url ? `<img src="${l.image_url}" style="width: 50px; height: 50px; border-radius: 50%; object-fit: cover;">` : '<span style="color:#999;">No image</span>'}</td>
                                        <td>${this.escapeHtml(l.name)}</td>
                                        <td>${this.escapeHtml(l.title_en)}</td>
                                        <td>${this.escapeHtml(l.phone || '-')}</td>
                                        <td>${l.display_order}</td>
                                        <td>${l.is_active ? '<span style="color:#10b981;">Yes</span>' : '<span style="color:#6b7280;">No</span>'}</td>
                                        <td>
                                            <a href="/admin/leaders/edit/${l.id}" class="btn btn-sm"><i class="fas fa-edit"></i> Edit</a>
                                            <a href="/admin/leaders/delete/${l.id}" class="btn btn-sm btn-danger" onclick="return confirm('Are you sure you want to delete this leader?')"><i class="fas fa-trash"></i> Delete</a>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    `}
                </div>
            </div>
        </body>
        </html>`;
    }

    renderAddLeaderForm() {
        return `
            <h2>Add New Leader</h2>
            <form action="/admin/leaders/add" method="POST" enctype="multipart/form-data">
                <div class="form-group">
                    <label>Full Name *</label>
                    <input type="text" name="name" required>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Title (English) *</label>
                        <input type="text" name="title_en" required>
                    </div>
                    <div class="form-group">
                        <label>Title (አማርኛ) *</label>
                        <input type="text" name="title_am" required>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Description (English)</label>
                        <textarea name="description_en" rows="4"></textarea>
                    </div>
                    <div class="form-group">
                        <label>Description (አማርኛ)</label>
                        <textarea name="description_am" rows="4"></textarea>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Phone Number</label>
                        <input type="text" name="phone">
                    </div>
                    <div class="form-group">
                        <label>Email</label>
                        <input type="email" name="email">
                    </div>
                </div>
                <div class="form-group">
                    <label>Profile Image</label>
                    <input type="file" name="image" accept="image/*">
                    <small style="color: #666;">Leave empty to keep current image (when editing)</small>
                </div>
                <div class="form-group">
                    <label>Display Order</label>
                    <input type="number" name="display_order" value="1">
                </div>
                <div class="form-group">
                    <label>Active</label>
                    <select name="is_active">
                        <option value="1">Yes</option>
                        <option value="0">No</option>
                    </select>
                </div>
                <button type="submit" class="btn"><i class="fas fa-save"></i> Add Leader</button>
                <a href="/admin/leaders" class="btn" style="background: #6b7280;"><i class="fas fa-times"></i> Cancel</a>
            </form>
        `;
    }

    async addLeader(req, res) {
        try {
            const { name, title_en, title_am, description_en, description_am, phone, email, display_order, is_active } = req.body;
            await this.db.run(
                `INSERT INTO leaders (name, title_en, title_am, description_en, description_am, phone, email, image_url, display_order, is_active) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [name, title_en, title_am, description_en || null, description_am || null, phone || null, email || null,
                 req.file ? `/uploads/images/${req.file.filename}` : null, display_order || 1, is_active || 1]
            );
            res.redirect("/admin/leaders?success=Leader added successfully");
        } catch (error) {
            console.error("Add leader error:", error);
            res.redirect("/admin/leaders?error=" + encodeURIComponent(error.message));
        }
    }

    async editLeader(req, res) {
        try {
            const leader = await this.db.get("SELECT * FROM leaders WHERE id = ?", [req.params.id]);
            if (!leader) return res.redirect("/admin/leaders?error=Leader not found");
            res.send(this.renderEditLeaderForm(leader));
        } catch (error) {
            console.error("Edit leader error:", error);
            res.redirect("/admin/leaders?error=" + encodeURIComponent(error.message));
        }
    }

    renderEditLeaderForm(leader) {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Edit Leader - Hadiya Transport</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', sans-serif; background: #f5f7fa; padding: 30px; }
                .container { max-width: 800px; margin: 0 auto; }
                .back-link { display: inline-block; margin-bottom: 20px; color: #1e78ff; text-decoration: none; }
                .card { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                h1 { color: #061e29; margin-bottom: 20px; }
                .form-group { margin-bottom: 20px; }
                label { display: block; margin-bottom: 8px; font-weight: 600; color: #333; }
                input, textarea, select { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; }
                .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                .btn { display: inline-block; padding: 12px 25px; background: #1e78ff; color: white; text-decoration: none; border-radius: 8px; border: none; cursor: pointer; font-size: 16px; }
                .btn-secondary { background: #6b7280; }
                .current-image { margin: 10px 0; }
                .current-image img { max-width: 150px; border-radius: 8px; border: 1px solid #eee; }
            </style>
        </head>
        <body>
            <div class="container">
                <a href="/admin/leaders" class="back-link">← Back to Leaders</a>
                <div class="card">
                    <h1><i class="fas fa-edit"></i> Edit Leader</h1>
                    <form action="/admin/leaders/update/${leader.id}" method="POST" enctype="multipart/form-data">
                        <div class="form-group">
                            <label>Full Name *</label>
                            <input type="text" name="name" value="${this.escapeHtml(leader.name)}" required>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Title (English) *</label>
                                <input type="text" name="title_en" value="${this.escapeHtml(leader.title_en)}" required>
                            </div>
                            <div class="form-group">
                                <label>Title (አማርኛ) *</label>
                                <input type="text" name="title_am" value="${this.escapeHtml(leader.title_am)}" required>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Description (English)</label>
                                <textarea name="description_en" rows="4">${this.escapeHtml(leader.description_en || '')}</textarea>
                            </div>
                            <div class="form-group">
                                <label>Description (አማርኛ)</label>
                                <textarea name="description_am" rows="4">${this.escapeHtml(leader.description_am || '')}</textarea>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Phone Number</label>
                                <input type="text" name="phone" value="${this.escapeHtml(leader.phone || '')}">
                            </div>
                            <div class="form-group">
                                <label>Email</label>
                                <input type="email" name="email" value="${this.escapeHtml(leader.email || '')}">
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Profile Image</label>
                            ${leader.image_url ? `<div class="current-image"><img src="${leader.image_url}" alt="Current Image"><br><small>Current image. Upload new to replace.</small></div>` : ''}
                            <input type="file" name="image" accept="image/*">
                        </div>
                        <div class="form-group">
                            <label>Display Order</label>
                            <input type="number" name="display_order" value="${leader.display_order || 1}">
                        </div>
                        <div class="form-group">
                            <label>Active</label>
                            <select name="is_active">
                                <option value="1" ${leader.is_active == 1 ? 'selected' : ''}>Yes</option>
                                <option value="0" ${leader.is_active == 0 ? 'selected' : ''}>No</option>
                            </select>
                        </div>
                        <button type="submit" class="btn"><i class="fas fa-save"></i> Update Leader</button>
                        <a href="/admin/leaders" class="btn btn-secondary"><i class="fas fa-times"></i> Cancel</a>
                    </form>
                </div>
            </div>
        </body>
        </html>`;
    }

    async updateLeader(req, res) {
        try {
            const { id } = req.params;
            const { name, title_en, title_am, description_en, description_am, phone, email, display_order, is_active } = req.body;

            const current = await this.db.get("SELECT image_url FROM leaders WHERE id = ?", [id]);
            let imageUrl = current?.image_url;

            if (req.file) {
                imageUrl = `/uploads/images/${req.file.filename}`;
                if (current?.image_url) {
                    const oldPath = path.join(__dirname, './public', current.image_url);
                    fs.unlink(oldPath, (err) => { if (err) console.error('Failed to delete old image:', err); });
                }
            }

            await this.db.run(
                `UPDATE leaders SET 
                    name = ?, title_en = ?, title_am = ?, description_en = ?, description_am = ?, 
                    phone = ?, email = ?, image_url = ?, display_order = ?, is_active = ? 
                 WHERE id = ?`,
                [name, title_en, title_am, description_en || null, description_am || null,
                 phone || null, email || null, imageUrl, display_order || 1, is_active || 1, id]
            );
            res.redirect("/admin/leaders?success=Leader updated successfully");
        } catch (error) {
            console.error("Update leader error:", error);
            res.redirect(`/admin/leaders/edit/${req.params.id}?error=` + encodeURIComponent(error.message));
        }
    }

    async deleteLeader(req, res) {
        try {
            const leader = await this.db.get("SELECT image_url FROM leaders WHERE id = ?", [req.params.id]);
            if (leader?.image_url) {
                const oldPath = path.join(__dirname, './public', leader.image_url);
                fs.unlink(oldPath, (err) => { if (err) console.error('Failed to delete image:', err); });
            }
            await this.db.run("DELETE FROM leaders WHERE id = ?", [req.params.id]);
            res.redirect("/admin/leaders?success=Leader deleted successfully");
        } catch (error) {
            res.redirect("/admin/leaders?error=" + encodeURIComponent(error.message));
        }
    }

    // ---------- SERVICES ----------
    async listServices(req, res) {
        try {
            const services = await this.db.all("SELECT * FROM services ORDER BY display_order");
            const action = req.query.action;
            res.send(this.renderServices(services, action, req.query));
        } catch (error) {
            console.error("Services management error:", error);
            res.status(500).send("Error loading services management");
        }
    }

    renderServices(services, action, query = {}) {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Services Management - Hadiya Transport</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                /* Same base styles as in renderLeaders */
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', sans-serif; background: #f5f7fa; padding: 30px; }
                .container { max-width: 1200px; margin: 0 auto; }
                .back-link { display: inline-block; margin-bottom: 20px; color: #1e78ff; text-decoration: none; }
                .card { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                h1 { color: #061e29; margin-bottom: 20px; }
                .btn { display: inline-block; padding: 12px 25px; background: #1e78ff; color: white; text-decoration: none; border-radius: 8px; border: none; cursor: pointer; font-size: 16px; }
                .btn-sm { padding: 6px 12px; font-size: 14px; }
                .btn-danger { background: #dc2626; }
                .table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                .table th, .table td { padding: 15px; text-align: left; border-bottom: 1px solid #eee; }
                .table th { background: #f8fafc; }
                .form-group { margin-bottom: 20px; }
                label { display: block; margin-bottom: 8px; font-weight: 600; color: #333; }
                input, textarea, select { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; }
                .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                .alert { padding: 15px; border-radius: 8px; margin-bottom: 20px; }
                .alert-success { background: #d1fae5; color: #065f46; }
                .alert-error { background: #fee2e2; color: #dc2626; }
            </style>
        </head>
        <body>
            <div class="container">
                <a href="/admin/dashboard" class="back-link">← Back to Dashboard</a>
                ${query.success ? `<div class="alert alert-success">${this.escapeHtml(query.success)}</div>` : ''}
                ${query.error ? `<div class="alert alert-error">${this.escapeHtml(query.error)}</div>` : ''}
                <div class="card">
                    <h1><i class="fas fa-cogs"></i> Services Management</h1>
                    ${action === 'add' ? this.renderAddServiceForm() : `
                        <a href="/admin/services?action=add" class="btn" style="margin-bottom: 20px;"><i class="fas fa-plus"></i> Add New Service</a>
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Title (EN)</th>
                                    <th>Title (AM)</th>
                                    <th>Icon</th>
                                    <th>Order</th>
                                    <th>Active</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${services.map(s => `
                                    <tr>
                                        <td>${this.escapeHtml(s.title_en)}</td>
                                        <td>${this.escapeHtml(s.title_am)}</td>
                                        <td><i class="fas ${s.icon || 'fa-cog'}"></i> ${s.icon || ''}</td>
                                        <td>${s.display_order}</td>
                                        <td>${s.is_active ? '<span style="color:#10b981;">Yes</span>' : '<span style="color:#6b7280;">No</span>'}</td>
                                        <td>
                                            <a href="/admin/services/edit/${s.id}" class="btn btn-sm"><i class="fas fa-edit"></i> Edit</a>
                                            <a href="/admin/services/delete/${s.id}" class="btn btn-sm btn-danger" onclick="return confirm('Delete this service?')"><i class="fas fa-trash"></i> Delete</a>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    `}
                </div>
            </div>
        </body>
        </html>`;
    }

    renderAddServiceForm() {
        return `
            <h2>Add New Service</h2>
            <form action="/admin/services/add" method="POST">
                <div class="form-row">
                    <div class="form-group">
                        <label>Title (English) *</label>
                        <input type="text" name="title_en" required>
                    </div>
                    <div class="form-group">
                        <label>Title (አማርኛ) *</label>
                        <input type="text" name="title_am" required>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Description (English)</label>
                        <textarea name="description_en" rows="4"></textarea>
                    </div>
                    <div class="form-group">
                        <label>Description (አማርኛ)</label>
                        <textarea name="description_am" rows="4"></textarea>
                    </div>
                </div>
                <div class="form-group">
                    <label>Icon (FontAwesome class, e.g., "fa-truck")</label>
                    <input type="text" name="icon" placeholder="fa-cog">
                </div>
                <div class="form-group">
                    <label>Display Order</label>
                    <input type="number" name="display_order" value="1">
                </div>
                <div class="form-group">
                    <label>Active</label>
                    <select name="is_active">
                        <option value="1">Yes</option>
                        <option value="0">No</option>
                    </select>
                </div>
                <button type="submit" class="btn"><i class="fas fa-save"></i> Add Service</button>
                <a href="/admin/services" class="btn" style="background: #6b7280;"><i class="fas fa-times"></i> Cancel</a>
            </form>
        `;
    }

    async addService(req, res) {
        try {
            const { title_en, title_am, description_en, description_am, icon, display_order, is_active } = req.body;
            await this.db.run(
                `INSERT INTO services (title_en, title_am, description_en, description_am, icon, display_order, is_active) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [title_en, title_am, description_en || null, description_am || null, icon || 'fa-cog', display_order || 1, is_active || 1]
            );
            res.redirect("/admin/services?success=Service added successfully");
        } catch (error) {
            res.redirect("/admin/services?error=" + encodeURIComponent(error.message));
        }
    }

    async editService(req, res) {
        try {
            const service = await this.db.get("SELECT * FROM services WHERE id = ?", [req.params.id]);
            if (!service) return res.redirect("/admin/services?error=Service not found");
            res.send(this.renderEditServiceForm(service));
        } catch (error) {
            console.error("Edit service error:", error);
            res.redirect("/admin/services?error=" + encodeURIComponent(error.message));
        }
    }

    renderEditServiceForm(service) {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Edit Service - Hadiya Transport</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                /* Same as edit leader form */
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', sans-serif; background: #f5f7fa; padding: 30px; }
                .container { max-width: 800px; margin: 0 auto; }
                .back-link { display: inline-block; margin-bottom: 20px; color: #1e78ff; text-decoration: none; }
                .card { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                h1 { color: #061e29; margin-bottom: 20px; }
                .form-group { margin-bottom: 20px; }
                label { display: block; margin-bottom: 8px; font-weight: 600; color: #333; }
                input, textarea, select { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; }
                .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                .btn { display: inline-block; padding: 12px 25px; background: #1e78ff; color: white; text-decoration: none; border-radius: 8px; border: none; cursor: pointer; }
                .btn-secondary { background: #6b7280; }
            </style>
        </head>
        <body>
            <div class="container">
                <a href="/admin/services" class="back-link">← Back to Services</a>
                <div class="card">
                    <h1><i class="fas fa-edit"></i> Edit Service</h1>
                    <form action="/admin/services/update/${service.id}" method="POST">
                        <div class="form-row">
                            <div class="form-group">
                                <label>Title (English) *</label>
                                <input type="text" name="title_en" value="${this.escapeHtml(service.title_en)}" required>
                            </div>
                            <div class="form-group">
                                <label>Title (አማርኛ) *</label>
                                <input type="text" name="title_am" value="${this.escapeHtml(service.title_am)}" required>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Description (English)</label>
                                <textarea name="description_en" rows="4">${this.escapeHtml(service.description_en || '')}</textarea>
                            </div>
                            <div class="form-group">
                                <label>Description (አማርኛ)</label>
                                <textarea name="description_am" rows="4">${this.escapeHtml(service.description_am || '')}</textarea>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Icon (FontAwesome class)</label>
                            <input type="text" name="icon" value="${this.escapeHtml(service.icon || 'fa-cog')}">
                        </div>
                        <div class="form-group">
                            <label>Display Order</label>
                            <input type="number" name="display_order" value="${service.display_order || 1}">
                        </div>
                        <div class="form-group">
                            <label>Active</label>
                            <select name="is_active">
                                <option value="1" ${service.is_active == 1 ? 'selected' : ''}>Yes</option>
                                <option value="0" ${service.is_active == 0 ? 'selected' : ''}>No</option>
                            </select>
                        </div>
                        <button type="submit" class="btn"><i class="fas fa-save"></i> Update Service</button>
                        <a href="/admin/services" class="btn btn-secondary"><i class="fas fa-times"></i> Cancel</a>
                    </form>
                </div>
            </div>
        </body>
        </html>`;
    }

    async updateService(req, res) {
        try {
            const { id } = req.params;
            const { title_en, title_am, description_en, description_am, icon, display_order, is_active } = req.body;
            await this.db.run(
                `UPDATE services SET 
                    title_en = ?, title_am = ?, description_en = ?, description_am = ?, 
                    icon = ?, display_order = ?, is_active = ? 
                 WHERE id = ?`,
                [title_en, title_am, description_en || null, description_am || null,
                 icon || 'fa-cog', display_order || 1, is_active || 1, id]
            );
            res.redirect("/admin/services?success=Service updated successfully");
        } catch (error) {
            res.redirect(`/admin/services/edit/${req.params.id}?error=` + encodeURIComponent(error.message));
        }
    }

    async deleteService(req, res) {
        try {
            await this.db.run("DELETE FROM services WHERE id = ?", [req.params.id]);
            res.redirect("/admin/services?success=Service deleted successfully");
        } catch (error) {
            res.redirect("/admin/services?error=" + encodeURIComponent(error.message));
        }
    }

    // ---------- NEWS ----------
    async listNews(req, res) {
        try {
            const news = await this.db.all("SELECT * FROM news ORDER BY created_at DESC");
            const action = req.query.action;
            res.send(this.renderNews(news, action, req.query));
        } catch (error) {
            console.error("News management error:", error);
            res.status(500).send("Error loading news management");
        }
    }

    renderNews(news, action, query = {}) {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>News Management - Hadiya Transport</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                /* Same base styles */
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', sans-serif; background: #f5f7fa; padding: 30px; }
                .container { max-width: 1200px; margin: 0 auto; }
                .back-link { display: inline-block; margin-bottom: 20px; color: #1e78ff; text-decoration: none; }
                .card { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                h1 { color: #061e29; margin-bottom: 20px; }
                .btn { display: inline-block; padding: 12px 25px; background: #1e78ff; color: white; text-decoration: none; border-radius: 8px; border: none; cursor: pointer; font-size: 16px; }
                .btn-sm { padding: 6px 12px; font-size: 14px; }
                .btn-danger { background: #dc2626; }
                .table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                .table th, .table td { padding: 15px; text-align: left; border-bottom: 1px solid #eee; }
                .table th { background: #f8fafc; }
                .form-group { margin-bottom: 20px; }
                label { display: block; margin-bottom: 8px; font-weight: 600; color: #333; }
                input, textarea, select { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; }
                .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                .alert { padding: 15px; border-radius: 8px; margin-bottom: 20px; }
                .alert-success { background: #d1fae5; color: #065f46; }
                .alert-error { background: #fee2e2; color: #dc2626; }
                .news-image { width: 60px; height: 60px; object-fit: cover; border-radius: 4px; }
            </style>
        </head>
        <body>
            <div class="container">
                <a href="/admin/dashboard" class="back-link">← Back to Dashboard</a>
                ${query.success ? `<div class="alert alert-success">${this.escapeHtml(query.success)}</div>` : ''}
                ${query.error ? `<div class="alert alert-error">${this.escapeHtml(query.error)}</div>` : ''}
                <div class="card">
                    <h1><i class="fas fa-newspaper"></i> News Management</h1>
                    ${action === 'add' ? this.renderAddNewsForm() : `
                        <a href="/admin/news?action=add" class="btn" style="margin-bottom: 20px;"><i class="fas fa-plus"></i> Add News Article</a>
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Image</th>
                                    <th>Title (EN)</th>
                                    <th>Category</th>
                                    <th>Date</th>
                                    <th>Published</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${news.map(n => `
                                    <tr>
                                        <td>${n.image_url ? `<img src="${n.image_url}" class="news-image">` : '<span style="color:#999;">No image</span>'}</td>
                                        <td>${this.escapeHtml(n.title_en.substring(0, 50))}${n.title_en.length > 50 ? '...' : ''}</td>
                                        <td>${this.escapeHtml(n.category_en)}</td>
                                        <td>${n.date ? new Date(n.date).toLocaleDateString() : new Date(n.created_at).toLocaleDateString()}</td>
                                        <td>${n.is_published ? '<span style="color:#10b981;">Yes</span>' : '<span style="color:#6b7280;">No</span>'}</td>
                                        <td>
                                            <a href="/admin/news/edit/${n.id}" class="btn btn-sm"><i class="fas fa-edit"></i> Edit</a>
                                            <a href="/admin/news/delete/${n.id}" class="btn btn-sm btn-danger" onclick="return confirm('Delete this news article?')"><i class="fas fa-trash"></i> Delete</a>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    `}
                </div>
            </div>
        </body>
        </html>`;
    }

    renderAddNewsForm() {
        return `
            <h2>Add New News Article</h2>
            <form action="/admin/news/add" method="POST" enctype="multipart/form-data">
                <div class="form-row">
                    <div class="form-group">
                        <label>Title (English) *</label>
                        <input type="text" name="title_en" required>
                    </div>
                    <div class="form-group">
                        <label>Title (አማርኛ) *</label>
                        <input type="text" name="title_am" required>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Description (English) *</label>
                        <textarea name="description_en" rows="6" required></textarea>
                    </div>
                    <div class="form-group">
                        <label>Description (አማርኛ) *</label>
                        <textarea name="description_am" rows="6" required></textarea>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Category (English)</label>
                        <input type="text" name="category_en" placeholder="Transport" value="Transport">
                    </div>
                    <div class="form-group">
                        <label>Category (አማርኛ)</label>
                        <input type="text" name="category_am" placeholder="ትራንስፖርት" value="ትራንስፖርት">
                    </div>
                </div>
                <div class="form-group">
                    <label>Featured Image</label>
                    <input type="file" name="image" accept="image/*">
                </div>
                <div class="form-group">
                    <label>Publish Date</label>
                    <input type="date" name="date">
                </div>
                <div class="form-group">
                    <label>Published</label>
                    <select name="is_published">
                        <option value="1">Yes</option>
                        <option value="0">No</option>
                    </select>
                </div>
                <button type="submit" class="btn"><i class="fas fa-save"></i> Add News</button>
                <a href="/admin/news" class="btn" style="background: #6b7280;"><i class="fas fa-times"></i> Cancel</a>
            </form>
        `;
    }

    async addNews(req, res) {
        try {
            const { title_en, title_am, description_en, description_am, category_en, category_am, date, is_published } = req.body;
            await this.db.run(
                `INSERT INTO news (title_en, title_am, description_en, description_am, category_en, category_am, image_url, date, is_published, created_by) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [title_en, title_am, description_en, description_am, category_en || 'Transport', category_am || 'ትራንስፖርት',
                 req.file ? `/uploads/media/${req.file.filename}` : null, date || null, is_published || 1, req.session.admin.username]
            );
            res.redirect("/admin/news?success=News added successfully");
        } catch (error) {
            res.redirect("/admin/news?error=" + encodeURIComponent(error.message));
        }
    }

    async editNews(req, res) {
        try {
            const news = await this.db.get("SELECT * FROM news WHERE id = ?", [req.params.id]);
            if (!news) return res.redirect("/admin/news?error=News not found");
            res.send(this.renderEditNewsForm(news));
        } catch (error) {
            console.error("Edit news error:", error);
            res.redirect("/admin/news?error=" + encodeURIComponent(error.message));
        }
    }

    renderEditNewsForm(news) {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Edit News - Hadiya Transport</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', sans-serif; background: #f5f7fa; padding: 30px; }
                .container { max-width: 800px; margin: 0 auto; }
                .back-link { display: inline-block; margin-bottom: 20px; color: #1e78ff; text-decoration: none; }
                .card { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                h1 { color: #061e29; margin-bottom: 20px; }
                .form-group { margin-bottom: 20px; }
                label { display: block; margin-bottom: 8px; font-weight: 600; color: #333; }
                input, textarea, select { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; }
                .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                .btn { display: inline-block; padding: 12px 25px; background: #1e78ff; color: white; text-decoration: none; border-radius: 8px; border: none; cursor: pointer; }
                .btn-secondary { background: #6b7280; }
                .current-image { margin: 10px 0; }
                .current-image img { max-width: 200px; border-radius: 8px; border: 1px solid #eee; }
            </style>
        </head>
        <body>
            <div class="container">
                <a href="/admin/news" class="back-link">← Back to News</a>
                <div class="card">
                    <h1><i class="fas fa-edit"></i> Edit News Article</h1>
                    <form action="/admin/news/update/${news.id}" method="POST" enctype="multipart/form-data">
                        <div class="form-row">
                            <div class="form-group">
                                <label>Title (English) *</label>
                                <input type="text" name="title_en" value="${this.escapeHtml(news.title_en)}" required>
                            </div>
                            <div class="form-group">
                                <label>Title (አማርኛ) *</label>
                                <input type="text" name="title_am" value="${this.escapeHtml(news.title_am)}" required>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Description (English) *</label>
                                <textarea name="description_en" rows="6" required>${this.escapeHtml(news.description_en)}</textarea>
                            </div>
                            <div class="form-group">
                                <label>Description (አማርኛ) *</label>
                                <textarea name="description_am" rows="6" required>${this.escapeHtml(news.description_am)}</textarea>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Category (English)</label>
                                <input type="text" name="category_en" value="${this.escapeHtml(news.category_en || 'Transport')}">
                            </div>
                            <div class="form-group">
                                <label>Category (አማርኛ)</label>
                                <input type="text" name="category_am" value="${this.escapeHtml(news.category_am || 'ትራንስፖርት')}">
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Featured Image</label>
                            ${news.image_url ? `<div class="current-image"><img src="${news.image_url}" alt="Current Image"><br><small>Current image. Upload new to replace.</small></div>` : ''}
                            <input type="file" name="image" accept="image/*">
                        </div>
                        <div class="form-group">
                            <label>Publish Date</label>
                            <input type="date" name="date" value="${news.date ? new Date(news.date).toISOString().split('T')[0] : ''}">
                        </div>
                        <div class="form-group">
                            <label>Published</label>
                            <select name="is_published">
                                <option value="1" ${news.is_published == 1 ? 'selected' : ''}>Yes</option>
                                <option value="0" ${news.is_published == 0 ? 'selected' : ''}>No</option>
                            </select>
                        </div>
                        <button type="submit" class="btn"><i class="fas fa-save"></i> Update News</button>
                        <a href="/admin/news" class="btn btn-secondary"><i class="fas fa-times"></i> Cancel</a>
                    </form>
                </div>
            </div>
        </body>
        </html>`;
    }

    async updateNews(req, res) {
        try {
            const { id } = req.params;
            const { title_en, title_am, description_en, description_am, category_en, category_am, date, is_published } = req.body;
            const current = await this.db.get("SELECT image_url FROM news WHERE id = ?", [id]);
            let imageUrl = current?.image_url;
            if (req.file) {
                imageUrl = `/uploads/media/${req.file.filename}`;
                if (current?.image_url) {
                    const oldPath = path.join(__dirname, './public', current.image_url);
                    fs.unlink(oldPath, (err) => { if (err) console.error('Failed to delete old image:', err); });
                }
            }
            await this.db.run(
                `UPDATE news SET 
                    title_en = ?, title_am = ?, description_en = ?, description_am = ?, 
                    category_en = ?, category_am = ?, image_url = ?, date = ?, is_published = ? 
                 WHERE id = ?`,
                [title_en, title_am, description_en, description_am, 
                 category_en || 'Transport', category_am || 'ትራንስፖርት', 
                 imageUrl, date || null, is_published || 1, id]
            );
            res.redirect("/admin/news?success=News updated successfully");
        } catch (error) {
            res.redirect(`/admin/news/edit/${req.params.id}?error=` + encodeURIComponent(error.message));
        }
    }

    async deleteNews(req, res) {
        try {
            const news = await this.db.get("SELECT image_url FROM news WHERE id = ?", [req.params.id]);
            if (news?.image_url) {
                const oldPath = path.join(__dirname, './public', news.image_url);
                fs.unlink(oldPath, (err) => { if (err) console.error('Failed to delete image:', err); });
            }
            await this.db.run("DELETE FROM news WHERE id = ?", [req.params.id]);
            res.redirect("/admin/news?success=News deleted successfully");
        } catch (error) {
            res.redirect("/admin/news?error=" + encodeURIComponent(error.message));
        }
    }

    // ---------- ANNOUNCEMENTS ----------
    async listAnnouncements(req, res) {
        try {
            const announcements = await this.db.all("SELECT * FROM announcements ORDER BY created_at DESC");
            const action = req.query.action;
            res.send(this.renderAnnouncements(announcements, action, req.query));
        } catch (error) {
            console.error("Announcements management error:", error);
            res.status(500).send("Error loading announcements management");
        }
    }

    renderAnnouncements(announcements, action, query = {}) {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Announcements Management - Hadiya Transport</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                /* Same base styles as news */
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', sans-serif; background: #f5f7fa; padding: 30px; }
                .container { max-width: 1200px; margin: 0 auto; }
                .back-link { display: inline-block; margin-bottom: 20px; color: #1e78ff; text-decoration: none; }
                .card { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                h1 { color: #061e29; margin-bottom: 20px; }
                .btn { display: inline-block; padding: 12px 25px; background: #1e78ff; color: white; text-decoration: none; border-radius: 8px; border: none; cursor: pointer; font-size: 16px; }
                .btn-sm { padding: 6px 12px; font-size: 14px; }
                .btn-danger { background: #dc2626; }
                .table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                .table th, .table td { padding: 15px; text-align: left; border-bottom: 1px solid #eee; }
                .table th { background: #f8fafc; }
                .form-group { margin-bottom: 20px; }
                label { display: block; margin-bottom: 8px; font-weight: 600; color: #333; }
                input, textarea, select { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; }
                .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                .alert { padding: 15px; border-radius: 8px; margin-bottom: 20px; }
                .alert-success { background: #d1fae5; color: #065f46; }
                .alert-error { background: #fee2e2; color: #dc2626; }
            </style>
        </head>
        <body>
            <div class="container">
                <a href="/admin/dashboard" class="back-link">← Back to Dashboard</a>
                ${query.success ? `<div class="alert alert-success">${this.escapeHtml(query.success)}</div>` : ''}
                ${query.error ? `<div class="alert alert-error">${this.escapeHtml(query.error)}</div>` : ''}
                <div class="card">
                    <h1><i class="fas fa-bullhorn"></i> Announcements Management</h1>
                    ${action === 'add' ? this.renderAddAnnouncementForm() : `
                        <a href="/admin/announcements?action=add" class="btn" style="margin-bottom: 20px;"><i class="fas fa-plus"></i> Add Announcement</a>
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Title (EN)</th>
                                    <th>Type</th>
                                    <th>Date</th>
                                    <th>Attachment</th>
                                    <th>Published</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${announcements.map(a => `
                                    <tr>
                                        <td>${this.escapeHtml(a.title_en.substring(0, 50))}${a.title_en.length > 50 ? '...' : ''}</td>
                                        <td>${this.escapeHtml(a.type_en)}</td>
                                        <td>${a.date ? new Date(a.date).toLocaleDateString() : new Date(a.created_at).toLocaleDateString()}</td>
                                        <td>${a.attachment_url ? `<a href="${a.attachment_url}" target="_blank"><i class="fas fa-paperclip"></i> View</a>` : '-'}</td>
                                        <td>${a.is_published ? '<span style="color:#10b981;">Yes</span>' : '<span style="color:#6b7280;">No</span>'}</td>
                                        <td>
                                            <a href="/admin/announcements/edit/${a.id}" class="btn btn-sm"><i class="fas fa-edit"></i> Edit</a>
                                            <a href="/admin/announcements/delete/${a.id}" class="btn btn-sm btn-danger" onclick="return confirm('Delete this announcement?')"><i class="fas fa-trash"></i> Delete</a>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    `}
                </div>
            </div>
        </body>
        </html>`;
    }

    renderAddAnnouncementForm() {
        return `
            <h2>Add New Announcement</h2>
            <form action="/admin/announcements/add" method="POST" enctype="multipart/form-data">
                <div class="form-row">
                    <div class="form-group">
                        <label>Title (English) *</label>
                        <input type="text" name="title_en" required>
                    </div>
                    <div class="form-group">
                        <label>Title (አማርኛ) *</label>
                        <input type="text" name="title_am" required>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Description (English) *</label>
                        <textarea name="description_en" rows="6" required></textarea>
                    </div>
                    <div class="form-group">
                        <label>Description (አማርኛ) *</label>
                        <textarea name="description_am" rows="6" required></textarea>
                    </div>
                </div>
                <div class="form-group">
                    <label>Type</label>
                    <select name="type">
                        <option value="announcement">Announcement</option>
                        <option value="vacancy">Vacancy</option>
                        <option value="event">Event</option>
                        <option value="media">Media & Gallery</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Attachment (PDF, Image, Video)</label>
                    <input type="file" name="attachment">
                </div>
                <div class="form-group">
                    <label>Date</label>
                    <input type="date" name="date">
                </div>
                <div class="form-group">
                    <label>Published</label>
                    <select name="is_published">
                        <option value="1">Yes</option>
                        <option value="0">No</option>
                    </select>
                </div>
                <button type="submit" class="btn"><i class="fas fa-save"></i> Add Announcement</button>
                <a href="/admin/announcements" class="btn" style="background: #6b7280;"><i class="fas fa-times"></i> Cancel</a>
            </form>
        `;
    }

    async addAnnouncement(req, res) {
        try {
            const { title_en, title_am, description_en, description_am, type, date, is_published } = req.body;
            await this.db.run(
                `INSERT INTO announcements (title_en, title_am, description_en, description_am, type, type_en, type_am, attachment_url, date, is_published, created_by) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [title_en, title_am, description_en, description_am, type || 'announcement',
                 type === 'announcement' ? 'Announcement' : type === 'vacancy' ? 'Vacancy' : type === 'media' ? 'Media & Gallery' : 'Event',
                 type === 'announcement' ? 'ማስታወቂያ' : type === 'vacancy' ? 'ባዶ የሥራ መደቦች' : type === 'media' ? 'ሚዲያ' : 'ዝግጅት',
                 req.file ? `/uploads/media/${req.file.filename}` : null, date || null, is_published || 1, req.session.admin.username]
            );
            res.redirect("/admin/announcements?success=Announcement added successfully");
        } catch (error) {
            res.redirect("/admin/announcements?error=" + encodeURIComponent(error.message));
        }
    }

    async editAnnouncement(req, res) {
        try {
            const announcement = await this.db.get("SELECT * FROM announcements WHERE id = ?", [req.params.id]);
            if (!announcement) return res.redirect("/admin/announcements?error=Announcement not found");
            res.send(this.renderEditAnnouncementForm(announcement));
        } catch (error) {
            console.error("Edit announcement error:", error);
            res.redirect("/admin/announcements?error=" + encodeURIComponent(error.message));
        }
    }

    renderEditAnnouncementForm(announcement) {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Edit Announcement - Hadiya Transport</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                /* Same as edit news form */
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', sans-serif; background: #f5f7fa; padding: 30px; }
                .container { max-width: 800px; margin: 0 auto; }
                .back-link { display: inline-block; margin-bottom: 20px; color: #1e78ff; text-decoration: none; }
                .card { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                h1 { color: #061e29; margin-bottom: 20px; }
                .form-group { margin-bottom: 20px; }
                label { display: block; margin-bottom: 8px; font-weight: 600; color: #333; }
                input, textarea, select { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; }
                .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                .btn { display: inline-block; padding: 12px 25px; background: #1e78ff; color: white; text-decoration: none; border-radius: 8px; border: none; cursor: pointer; }
                .btn-secondary { background: #6b7280; }
                .current-attachment { margin: 10px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <a href="/admin/announcements" class="back-link">← Back to Announcements</a>
                <div class="card">
                    <h1><i class="fas fa-edit"></i> Edit Announcement</h1>
                    <form action="/admin/announcements/update/${announcement.id}" method="POST" enctype="multipart/form-data">
                        <div class="form-row">
                            <div class="form-group">
                                <label>Title (English) *</label>
                                <input type="text" name="title_en" value="${this.escapeHtml(announcement.title_en)}" required>
                            </div>
                            <div class="form-group">
                                <label>Title (አማርኛ) *</label>
                                <input type="text" name="title_am" value="${this.escapeHtml(announcement.title_am)}" required>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Description (English) *</label>
                                <textarea name="description_en" rows="6" required>${this.escapeHtml(announcement.description_en)}</textarea>
                            </div>
                            <div class="form-group">
                                <label>Description (አማርኛ) *</label>
                                <textarea name="description_am" rows="6" required>${this.escapeHtml(announcement.description_am)}</textarea>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Type</label>
                            <select name="type">
                                <option value="announcement" ${announcement.type === 'announcement' ? 'selected' : ''}>Announcement</option>
                                <option value="vacancy" ${announcement.type === 'vacancy' ? 'selected' : ''}>Vacancy</option>
                                <option value="event" ${announcement.type === 'event' ? 'selected' : ''}>Event</option>
                                <option value="media" ${announcement.type === 'media' ? 'selected' : ''}>Media & Gallery</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Attachment</label>
                            ${announcement.attachment_url ? `<div class="current-attachment"><a href="${announcement.attachment_url}" target="_blank">Current Attachment</a><br><small>Upload new to replace.</small></div>` : ''}
                            <input type="file" name="attachment">
                        </div>
                        <div class="form-group">
                            <label>Date</label>
                            <input type="date" name="date" value="${announcement.date ? new Date(announcement.date).toISOString().split('T')[0] : ''}">
                        </div>
                        <div class="form-group">
                            <label>Published</label>
                            <select name="is_published">
                                <option value="1" ${announcement.is_published == 1 ? 'selected' : ''}>Yes</option>
                                <option value="0" ${announcement.is_published == 0 ? 'selected' : ''}>No</option>
                            </select>
                        </div>
                        <button type="submit" class="btn"><i class="fas fa-save"></i> Update Announcement</button>
                        <a href="/admin/announcements" class="btn btn-secondary"><i class="fas fa-times"></i> Cancel</a>
                    </form>
                </div>
            </div>
        </body>
        </html>`;
    }

    async updateAnnouncement(req, res) {
        try {
            const { id } = req.params;
            const { title_en, title_am, description_en, description_am, type, date, is_published } = req.body;
            const current = await this.db.get("SELECT attachment_url FROM announcements WHERE id = ?", [id]);
            let attachmentUrl = current?.attachment_url;
            if (req.file) {
                attachmentUrl = `/uploads/media/${req.file.filename}`;
                if (current?.attachment_url) {
                    const oldPath = path.join(__dirname, './public', current.attachment_url);
                    fs.unlink(oldPath, (err) => { if (err) console.error('Failed to delete old attachment:', err); });
                }
            }
            await this.db.run(
                `UPDATE announcements SET 
                    title_en = ?, title_am = ?, description_en = ?, description_am = ?, 
                    type = ?, type_en = ?, type_am = ?, attachment_url = ?, date = ?, is_published = ? 
                 WHERE id = ?`,
                [title_en, title_am, description_en, description_am, type || 'announcement',
                 type === 'announcement' ? 'Announcement' : type === 'vacancy' ? 'Vacancy' : type === 'media' ? 'Media & Gallery' : 'Event',
                 type === 'announcement' ? 'ማስታወቂያ' : type === 'vacancy' ? 'ባዶ የሥራ መደቦች' : type === 'media' ? 'ሚዲያ' : 'ዝግጅት',
                 attachmentUrl, date || null, is_published || 1, id]
            );
            res.redirect("/admin/announcements?success=Announcement updated successfully");
        } catch (error) {
            res.redirect(`/admin/announcements/edit/${req.params.id}?error=` + encodeURIComponent(error.message));
        }
    }

    async deleteAnnouncement(req, res) {
        try {
            const announcement = await this.db.get("SELECT attachment_url FROM announcements WHERE id = ?", [req.params.id]);
            if (announcement?.attachment_url) {
                const oldPath = path.join(__dirname, './public', announcement.attachment_url);
                fs.unlink(oldPath, (err) => { if (err) console.error('Failed to delete attachment:', err); });
            }
            await this.db.run("DELETE FROM announcements WHERE id = ?", [req.params.id]);
            res.redirect("/admin/announcements?success=Announcement deleted successfully");
        } catch (error) {
            res.redirect("/admin/announcements?error=" + encodeURIComponent(error.message));
        }
    }

    // ---------- STATISTICS ----------
    async listStatistics(req, res) {
        try {
            const stats = await this.db.all("SELECT * FROM statistics ORDER BY id");
            res.send(this.renderStatistics(stats, req.query));
        } catch (error) {
            console.error("Statistics management error:", error);
            res.status(500).send("Error loading statistics management");
        }
    }

    renderStatistics(stats, query = {}) {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Statistics Management - Hadiya Transport</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', sans-serif; background: #f5f7fa; padding: 30px; }
                .container { max-width: 800px; margin: 0 auto; }
                .back-link { display: inline-block; margin-bottom: 20px; color: #1e78ff; text-decoration: none; }
                .card { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                h1 { color: #061e29; margin-bottom: 20px; }
                .stat-item { margin-bottom: 30px; border-bottom: 1px solid #eee; padding-bottom: 20px; }
                .stat-key { font-weight: 600; color: #1e78ff; margin-bottom: 10px; }
                .form-group { margin-bottom: 15px; }
                label { display: block; margin-bottom: 5px; font-weight: 600; color: #333; }
                input { width: 100%; padding: 10px; border: 2px solid #e0e0e0; border-radius: 6px; font-size: 16px; }
                .btn { padding: 12px 25px; background: #1e78ff; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; }
                .alert { padding: 15px; border-radius: 8px; margin-bottom: 20px; }
                .alert-success { background: #d1fae5; color: #065f46; }
                .alert-error { background: #fee2e2; color: #dc2626; }
            </style>
        </head>
        <body>
            <div class="container">
                <a href="/admin/dashboard" class="back-link">← Back to Dashboard</a>
                ${query.success ? `<div class="alert alert-success">${this.escapeHtml(query.success)}</div>` : ''}
                ${query.error ? `<div class="alert alert-error">${this.escapeHtml(query.error)}</div>` : ''}
                <div class="card">
                    <h1><i class="fas fa-chart-bar"></i> Statistics Management</h1>
                    <p style="margin-bottom: 20px; color: #666;">Update the statistics displayed on the public website.</p>
                    <form action="/admin/statistics/update" method="POST">
                        ${stats.map(s => `
                            <div class="stat-item">
                                <div class="stat-key">${s.stat_key}</div>
                                <div class="form-group">
                                    <label>Value</label>
                                    <input type="text" name="value_${s.stat_key}" value="${this.escapeHtml(s.stat_value)}">
                                </div>
                                <div class="form-group">
                                    <label>Label (English)</label>
                                    <input type="text" name="label_en_${s.stat_key}" value="${this.escapeHtml(s.label_en || '')}">
                                </div>
                                <div class="form-group">
                                    <label>Label (አማርኛ)</label>
                                    <input type="text" name="label_am_${s.stat_key}" value="${this.escapeHtml(s.label_am || '')}">
                                </div>
                                <input type="hidden" name="key" value="${s.stat_key}">
                            </div>
                        `).join('')}
                        <button type="submit" class="btn"><i class="fas fa-save"></i> Save All Changes</button>
                    </form>
                </div>
            </div>
        </body>
        </html>`;
    }

    async updateStatistics(req, res) {
        try {
            const stats = await this.db.all("SELECT stat_key FROM statistics");
            for (const stat of stats) {
                const key = stat.stat_key;
                const value = req.body[`value_${key}`];
                const label_en = req.body[`label_en_${key}`];
                const label_am = req.body[`label_am_${key}`];
                if (value !== undefined) {
                    await this.db.run(
                        "UPDATE statistics SET stat_value = ?, label_en = ?, label_am = ? WHERE stat_key = ?",
                        [value, label_en || null, label_am || null, key]
                    );
                }
            }
            res.redirect("/admin/statistics?success=Statistics updated successfully");
        } catch (error) {
            res.redirect("/admin/statistics?error=" + encodeURIComponent(error.message));
        }
    }

    // ---------- MESSAGES ----------
    async listMessages(req, res) {
        try {
            const messages = await this.db.all("SELECT * FROM contact_messages ORDER BY created_at DESC");
            // Mark all as read when listing (optional, we also mark single message as read when viewed)
            await this.db.run("UPDATE contact_messages SET is_read = 1 WHERE is_read = 0");
            res.send(this.renderMessages(messages, req.query));
        } catch (error) {
            console.error("Messages management error:", error);
            res.status(500).send("Error loading messages");
        }
    }

    renderMessages(messages, query = {}) {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Contact Messages - Hadiya Transport</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', sans-serif; background: #f5f7fa; padding: 30px; }
                .container { max-width: 1200px; margin: 0 auto; }
                .back-link { display: inline-block; margin-bottom: 20px; color: #1e78ff; text-decoration: none; }
                .card { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                h1 { color: #061e29; margin-bottom: 20px; }
                .btn { display: inline-block; padding: 12px 25px; background: #1e78ff; color: white; text-decoration: none; border-radius: 8px; }
                .btn-sm { padding: 6px 12px; font-size: 14px; }
                .btn-danger { background: #dc2626; }
                .table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                .table th, .table td { padding: 15px; text-align: left; border-bottom: 1px solid #eee; }
                .table th { background: #f8fafc; }
                .badge { background: #e4ff30; color: #061e29; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; }
                .alert { padding: 15px; border-radius: 8px; margin-bottom: 20px; }
                .alert-success { background: #d1fae5; color: #065f46; }
                .alert-error { background: #fee2e2; color: #dc2626; }
            </style>
        </head>
        <body>
            <div class="container">
                <a href="/admin/dashboard" class="back-link">← Back to Dashboard</a>
                ${query.success ? `<div class="alert alert-success">${this.escapeHtml(query.success)}</div>` : ''}
                ${query.error ? `<div class="alert alert-error">${this.escapeHtml(query.error)}</div>` : ''}
                <div class="card">
                    <h1><i class="fas fa-envelope"></i> Contact Messages</h1>
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Subject</th>
                                <th>Received</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${messages.map(m => `
                                <tr>
                                    <td>${this.escapeHtml(m.first_name)} ${this.escapeHtml(m.last_name)}</td>
                                    <td>${this.escapeHtml(m.email)}</td>
                                    <td>${this.escapeHtml(m.subject || 'No subject')}</td>
                                    <td>${new Date(m.created_at).toLocaleDateString()}</td>
                                    <td>${m.is_read ? 'Read' : '<span class="badge">New</span>'}</td>
                                    <td>
                                        <a href="/admin/messages/${m.id}" class="btn btn-sm"><i class="fas fa-eye"></i> View</a>
                                        <a href="/admin/messages/delete/${m.id}" class="btn btn-sm btn-danger" onclick="return confirm('Delete this message?')"><i class="fas fa-trash"></i> Delete</a>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    ${messages.length === 0 ? '<p style="text-align: center; color: #666; padding: 40px;">No messages yet.</p>' : ''}
                </div>
            </div>
        </body>
        </html>`;
    }

    async viewMessage(req, res) {
        try {
            const message = await this.db.get("SELECT * FROM contact_messages WHERE id = ?", [req.params.id]);
            if (!message) return res.redirect("/admin/messages?error=Message not found");
            // Mark as read when viewed
            await this.db.run("UPDATE contact_messages SET is_read = 1 WHERE id = ?", [req.params.id]);
            res.send(this.renderSingleMessage(message));
        } catch (error) {
            console.error("View message error:", error);
            res.redirect("/admin/messages?error=" + encodeURIComponent(error.message));
        }
    }

    renderSingleMessage(message) {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Message Details - Hadiya Transport</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', sans-serif; background: #f5f7fa; padding: 30px; }
                .container { max-width: 900px; margin: 0 auto; }
                .back-link { display: inline-block; margin-bottom: 20px; color: #1e78ff; text-decoration: none; }
                .card { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                h1 { color: #061e29; margin-bottom: 20px; }
                .message-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 20px; margin-bottom: 20px; }
                .field-group { margin-bottom: 20px; }
                .field-label { font-weight: 600; color: #666; margin-bottom: 5px; }
                .field-value { background: #f9f9f9; padding: 15px; border-radius: 8px; border: 1px solid #eee; }
                .attachment { background: #f0f7ff; padding: 15px; border-radius: 8px; }
                .btn { padding: 12px 25px; background: #1e78ff; color: white; border: none; border-radius: 8px; text-decoration: none; display: inline-block; margin-right: 10px; }
                .btn-danger { background: #dc2626; }
                .btn-secondary { background: #6b7280; }
            </style>
        </head>
        <body>
            <div class="container">
                <a href="/admin/messages" class="back-link">← Back to Messages</a>
                <div class="card">
                    <div class="message-header">
                        <h1><i class="fas fa-envelope-open-text"></i> Message from ${this.escapeHtml(message.first_name)} ${this.escapeHtml(message.last_name)}</h1>
                        <small>Received: ${new Date(message.created_at).toLocaleString()}</small>
                    </div>
                    <div class="field-group">
                        <div class="field-label">Contact Information</div>
                        <div class="field-value">
                            <strong>Email:</strong> <a href="mailto:${this.escapeHtml(message.email)}">${this.escapeHtml(message.email)}</a><br>
                            <strong>Phone:</strong> ${this.escapeHtml(message.phone || 'Not provided')}<br>
                            <strong>Subject:</strong> ${this.escapeHtml(message.subject || 'None')}<br>
                            <strong>Title:</strong> ${this.escapeHtml(message.title || 'None')}
                        </div>
                    </div>
                    <div class="field-group">
                        <div class="field-label">Message</div>
                        <div class="field-value" style="white-space: pre-wrap;">${this.escapeHtml(message.message)}</div>
                    </div>
                    ${message.attachment_url ? `
                    <div class="field-group">
                        <div class="field-label">Attachment</div>
                        <div class="attachment">
                            <i class="fas fa-paperclip"></i> 
                            <a href="${message.attachment_url}" target="_blank">Download Attachment</a>
                        </div>
                    </div>` : ''}
                    <div style="margin-top: 30px;">
                        <a href="/admin/messages/delete/${message.id}" class="btn btn-danger" onclick="return confirm('Delete this message?')"><i class="fas fa-trash"></i> Delete Message</a>
                        <a href="mailto:${this.escapeHtml(message.email)}" class="btn"><i class="fas fa-reply"></i> Reply via Email</a>
                        <a href="/admin/messages" class="btn btn-secondary"><i class="fas fa-arrow-left"></i> Back</a>
                    </div>
                </div>
            </div>
        </body>
        </html>`;
    }

    async deleteMessage(req, res) {
        try {
            const message = await this.db.get("SELECT attachment_url FROM contact_messages WHERE id = ?", [req.params.id]);
            if (message?.attachment_url) {
                const oldPath = path.join(__dirname, './public', message.attachment_url);
                fs.unlink(oldPath, (err) => { if (err) console.error('Failed to delete attachment:', err); });
            }
            await this.db.run("DELETE FROM contact_messages WHERE id = ?", [req.params.id]);
            res.redirect("/admin/messages?success=Message deleted successfully");
        } catch (error) {
            res.redirect("/admin/messages?error=" + encodeURIComponent(error.message));
        }
    }

    // ---------- SETTINGS ----------
    async listSettings(req, res) {
        try {
            const settings = await this.db.all("SELECT * FROM settings");
            res.send(this.renderSettings(settings, req.query));
        } catch (error) {
            console.error("Settings management error:", error);
            res.status(500).send("Error loading settings");
        }
    }

    renderSettings(settings, query = {}) {
        const settingsObj = {};
        settings.forEach(s => { settingsObj[s.setting_key] = s; });
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Settings - Hadiya Transport</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', sans-serif; background: #f5f7fa; padding: 30px; }
                .container { max-width: 800px; margin: 0 auto; }
                .back-link { display: inline-block; margin-bottom: 20px; color: #1e78ff; text-decoration: none; }
                .card { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                h1 { color: #061e29; margin-bottom: 20px; }
                .form-group { margin-bottom: 20px; }
                label { display: block; margin-bottom: 8px; font-weight: 600; color: #333; }
                input { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; }
                .btn { padding: 12px 25px; background: #1e78ff; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; }
                .alert { padding: 15px; border-radius: 8px; margin-bottom: 20px; }
                .alert-success { background: #d1fae5; color: #065f46; }
                .alert-error { background: #fee2e2; color: #dc2626; }
            </style>
        </head>
        <body>
            <div class="container">
                <a href="/admin/dashboard" class="back-link">← Back to Dashboard</a>
                ${query.success ? `<div class="alert alert-success">${this.escapeHtml(query.success)}</div>` : ''}
                ${query.error ? `<div class="alert alert-error">${this.escapeHtml(query.error)}</div>` : ''}
                <div class="card">
                    <h1><i class="fas fa-cog"></i> Site Settings</h1>
                    <form action="/admin/settings/update" method="POST">
                        <div class="form-group">
                            <label>Site Title (English)</label>
                            <input type="text" name="site_title_en" value="${this.escapeHtml(settingsObj.site_title?.setting_value_en || 'Hadiya Zone Transport Bureau')}">
                        </div>
                        <div class="form-group">
                            <label>Site Title (አማርኛ)</label>
                            <input type="text" name="site_title_am" value="${this.escapeHtml(settingsObj.site_title?.setting_value_am || 'ሀዲያ ዞን ትራንስፖርት ቢሮ')}">
                        </div>
                        <div class="form-group">
                            <label>Contact Phone</label>
                            <input type="text" name="contact_phone" value="${this.escapeHtml(settingsObj.contact_phone?.setting_value_en || '+251-46-112-2334')}">
                        </div>
                        <div class="form-group">
                            <label>Contact Email</label>
                            <input type="email" name="contact_email" value="${this.escapeHtml(settingsObj.contact_email?.setting_value_en || 'info@hadiyatransport.gov.et')}">
                        </div>
                        <div class="form-group">
                            <label>Address (English)</label>
                            <input type="text" name="contact_address_en" value="${this.escapeHtml(settingsObj.contact_address?.setting_value_en || 'Hosaena, Ethiopia')}">
                        </div>
                        <div class="form-group">
                            <label>Address (አማርኛ)</label>
                            <input type="text" name="contact_address_am" value="${this.escapeHtml(settingsObj.contact_address?.setting_value_am || 'ሆሳዕና፣ ኢትዮጵያ')}">
                        </div>
                        <button type="submit" class="btn"><i class="fas fa-save"></i> Save Settings</button>
                    </form>
                </div>
            </div>
        </body>
        </html>`;
    }

    async updateSettings(req, res) {
        try {
            const { site_title_en, site_title_am, contact_phone, contact_email, contact_address_en, contact_address_am } = req.body;
            
            await this.db.run(
                "UPDATE settings SET setting_value_en = ?, setting_value_am = ? WHERE setting_key = ?",
                [site_title_en, site_title_am, 'site_title']
            );
            await this.db.run(
                "UPDATE settings SET setting_value_en = ? WHERE setting_key = ?",
                [contact_phone, 'contact_phone']
            );
            await this.db.run(
                "UPDATE settings SET setting_value_en = ? WHERE setting_key = ?",
                [contact_email, 'contact_email']
            );
            await this.db.run(
                "UPDATE settings SET setting_value_en = ?, setting_value_am = ? WHERE setting_key = ?",
                [contact_address_en, contact_address_am, 'contact_address']
            );
            
            res.redirect("/admin/settings?success=Settings updated successfully");
        } catch (error) {
            res.redirect("/admin/settings?error=" + encodeURIComponent(error.message));
        }
    }

    // ---------- ADMIN PROFILE ----------
    async adminProfile(req, res) {
        try {
            const admin = await this.db.get(
                "SELECT id, username, full_name, email, role, last_login, created_at FROM admin_users WHERE id = ?",
                [req.session.admin.id]
            );
            res.send(this.renderProfileForm(admin, req.query));
        } catch (error) {
            console.error("Admin profile error:", error);
            res.status(500).send("Error loading profile");
        }
    }

    renderProfileForm(admin, query = {}) {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>My Profile - Hadiya Transport</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', sans-serif; background: #f5f7fa; padding: 30px; }
                .container { max-width: 600px; margin: 0 auto; }
                .back-link { display: inline-block; margin-bottom: 20px; color: #1e78ff; text-decoration: none; }
                .card { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
                h1 { color: #061e29; margin-bottom: 20px; }
                h2 { font-size: 1.3rem; margin: 20px 0; color: #333; }
                .form-group { margin-bottom: 20px; }
                label { display: block; margin-bottom: 8px; font-weight: 600; color: #333; }
                input { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; }
                .btn { padding: 12px 25px; background: #1e78ff; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; display: inline-block; text-decoration: none; }
                .btn-secondary { background: #6b7280; }
                .info-row { display: flex; margin-bottom: 15px; }
                .info-label { font-weight: 600; width: 120px; color: #666; }
                .info-value { flex: 1; }
                .separator { border-top: 1px solid #eee; margin: 30px 0; }
                .alert { padding: 15px; border-radius: 8px; margin-bottom: 20px; }
                .alert-success { background: #d1fae5; color: #065f46; }
                .alert-error { background: #fee2e2; color: #dc2626; }
            </style>
        </head>
        <body>
            <div class="container">
                <a href="/admin/dashboard" class="back-link">← Back to Dashboard</a>
                ${query.success ? `<div class="alert alert-success">${this.escapeHtml(query.success)}</div>` : ''}
                ${query.error ? `<div class="alert alert-error">${this.escapeHtml(query.error)}</div>` : ''}
                <div class="card">
                    <h1><i class="fas fa-user-circle"></i> My Profile</h1>
                    <div class="info-row">
                        <div class="info-label">Username:</div>
                        <div class="info-value"><strong>${this.escapeHtml(admin.username)}</strong></div>
                    </div>
                    <div class="info-row">
                        <div class="info-label">Role:</div>
                        <div class="info-value">${this.escapeHtml(admin.role)}</div>
                    </div>
                    <div class="info-row">
                        <div class="info-label">Last Login:</div>
                        <div class="info-value">${admin.last_login ? new Date(admin.last_login).toLocaleString() : 'Never'}</div>
                    </div>
                    <div class="info-row">
                        <div class="info-label">Member Since:</div>
                        <div class="info-value">${new Date(admin.created_at).toLocaleDateString()}</div>
                    </div>
                    
                    <div class="separator"></div>
                    <h2>Update Profile</h2>
                    <form action="/admin/profile/update" method="POST">
                        <div class="form-group">
                            <label>Full Name</label>
                            <input type="text" name="full_name" value="${this.escapeHtml(admin.full_name || '')}" required>
                        </div>
                        <div class="form-group">
                            <label>Email Address</label>
                            <input type="email" name="email" value="${this.escapeHtml(admin.email || '')}" required>
                        </div>
                        <button type="submit" class="btn"><i class="fas fa-save"></i> Save Changes</button>
                    </form>
                    
                    <div class="separator"></div>
                    <h2>Change Password</h2>
                    <form action="/admin/profile/password" method="POST">
                        <div class="form-group">
                            <label>Current Password</label>
                            <input type="password" name="current_password" required>
                        </div>
                        <div class="form-group">
                            <label>New Password</label>
                            <input type="password" name="new_password" required>
                        </div>
                        <div class="form-group">
                            <label>Confirm New Password</label>
                            <input type="password" name="confirm_password" required>
                        </div>
                        <button type="submit" class="btn"><i class="fas fa-key"></i> Change Password</button>
                    </form>
                </div>
            </div>
        </body>
        </html>`;
    }

    async updateAdminProfile(req, res) {
        try {
            const { full_name, email } = req.body;
            await this.db.run(
                "UPDATE admin_users SET full_name = ?, email = ? WHERE id = ?",
                [full_name, email, req.session.admin.id]
            );
            // Update session
            req.session.admin.full_name = full_name;
            req.session.admin.email = email;
            res.redirect("/admin/profile?success=Profile updated successfully");
        } catch (error) {
            console.error("Update profile error:", error);
            res.redirect("/admin/profile?error=" + encodeURIComponent(error.message));
        }
    }

    async changeAdminPassword(req, res) {
        try {
            const { current_password, new_password, confirm_password } = req.body;
            if (new_password !== confirm_password) {
                return res.redirect("/admin/profile?error=New passwords do not match");
            }
            const admin = await this.db.get("SELECT password FROM admin_users WHERE id = ?", [req.session.admin.id]);
            const valid = await bcrypt.compare(current_password, admin.password);
            if (!valid) {
                return res.redirect("/admin/profile?error=Current password is incorrect");
            }
            const hashed = await bcrypt.hash(new_password, 10);
            await this.db.run("UPDATE admin_users SET password = ? WHERE id = ?", [hashed, req.session.admin.id]);
            res.redirect("/admin/profile?success=Password changed successfully");
        } catch (error) {
            console.error("Change password error:", error);
            res.redirect("/admin/profile?error=" + encodeURIComponent(error.message));
        }
    }

    // Helper: Escape HTML
    escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

// ======================== PUBLIC API CONTROLLER ========================
class PublicApiController {
    constructor(db) {
        this.db = db;
    }

    async getSettings(req, res) {
        try {
            const settings = await this.db.all("SELECT * FROM settings");
            res.json(settings);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async getStatistics(req, res) {
        try {
            const stats = await this.db.all("SELECT * FROM statistics");
            res.json(stats);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async getLeaders(req, res) {
        try {
            const rows = await this.db.all("SELECT * FROM leaders WHERE is_active = 1 ORDER BY display_order");
            const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            const host = req.get('host') || `localhost:${process.env.PORT || 3016}`;
            const base = `${proto}://${host}`;
            const normalized = rows.map(r => {
                if (r.image_url) {
                    // If image_url already contains an uploads path, preserve it; otherwise
                    // attach the correct uploads path ending with the filename.
                    if (r.image_url.startsWith('/uploads')) {
                        r.image_url = base + r.image_url;
                    } else {
                        r.image_url = base + `/uploads/images/${path.basename(r.image_url)}`;
                    }
                }
                return r;
            });
            res.json(normalized);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async getServices(req, res) {
        try {
            const rows = await this.db.all("SELECT * FROM services WHERE is_active = 1 ORDER BY display_order");
            const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            const host = req.get('host') || `localhost:${process.env.PORT || 3016}`;
            const base = `${proto}://${host}`;
            const normalized = rows.map(r => {
                if (r.image_url) {
                    if (r.image_url.startsWith('/uploads')) {
                        r.image_url = base + r.image_url;
                    } else {
                        r.image_url = base + `/uploads/images/${path.basename(r.image_url)}`;
                    }
                }
                return r;
            });
            res.json(normalized);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async getNews(req, res) {
        try {
            const rows = await this.db.all("SELECT * FROM news WHERE is_published = 1 ORDER BY created_at DESC");
            const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            const host = req.get('host') || `localhost:${process.env.PORT || 3016}`;
            const base = `${proto}://${host}`;
            const normalized = rows.map(r => {
                if (r.image_url) {
                    if (r.image_url.startsWith('/uploads')) {
                        r.image_url = base + r.image_url;
                    } else {
                        r.image_url = base + `/uploads/media/${path.basename(r.image_url)}`;
                    }
                }
                return r;
            });
            res.json(normalized);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async getNewsById(req, res) {
        try {
            const news = await this.db.get("SELECT * FROM news WHERE id = ? AND is_published = 1", [req.params.id]);
            if (!news) return res.status(404).json({ error: 'News not found' });
            if (news.image_url) {
                const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
                const host = req.get('host') || `localhost:${process.env.PORT || 3016}`;
                const base2 = `${proto}://${host}`;
                if (news.image_url.startsWith('/uploads')) {
                    news.image_url = base2 + news.image_url;
                } else {
                    news.image_url = base2 + `/uploads/media/${path.basename(news.image_url)}`;
                }
            }
            res.json(news);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async getAnnouncements(req, res) {
        try {
            const rows = await this.db.all("SELECT * FROM announcements WHERE is_published = 1 ORDER BY created_at DESC");
            const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            const host = req.get('host') || `localhost:${process.env.PORT || 3016}`;
            const base = `${proto}://${host}`;
            const normalized = rows.map(r => {
                if (r.attachment_url) {
                    if (r.attachment_url.startsWith('/uploads')) {
                        r.attachment_url = base + r.attachment_url;
                    } else {
                        r.attachment_url = base + `/uploads/media/${path.basename(r.attachment_url)}`;
                    }
                }
                return r;
            });
            res.json(normalized);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    async submitContact(req, res) {
        try {
            const { first_name, last_name, email, phone, subject, title, message } = req.body;
            await this.db.run(
                `INSERT INTO contact_messages (first_name, last_name, email, phone, subject, title, message, attachment_url) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [first_name, last_name, email, phone || null, subject || null, title || null, message,
                 req.file ? `/uploads/${req.file.filename}` : null]
            );
            res.json({ success: true, message: 'Message sent successfully' });
        } catch (error) {
            console.error("Contact form error:", error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    async setLanguage(req, res) {
        const { lang } = req.body;
        if (lang === 'en' || lang === 'am') {
            req.session.lang = lang;
            res.json({ success: true });
        } else {
            res.status(400).json({ success: false, error: 'Invalid language' });
        }
    }

    async getConfig(req, res) {
        try {
            const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            const host = req.get('host') || `localhost:${process.env.PORT || 3016}`;
            res.json({ apiBaseUrl: `${proto}://${host}/api` });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
}

// ======================== INSTALLATION CONTROLLER ========================
class InstallController {
    constructor(db) {
        this.db = db;
    }

    async install(req, res) {
        try {
            // Create tables
            const tables = [
                `CREATE TABLE IF NOT EXISTS leaders (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    title_en VARCHAR(255) NOT NULL,
                    title_am VARCHAR(255) NOT NULL,
                    description_en TEXT,
                    description_am TEXT,
                    phone VARCHAR(50),
                    email VARCHAR(255),
                    image_url VARCHAR(500),
                    display_order INT DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )`,
                `CREATE TABLE IF NOT EXISTS services (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    title_en VARCHAR(255) NOT NULL,
                    title_am VARCHAR(255) NOT NULL,
                    description_en TEXT,
                    description_am TEXT,
                    icon VARCHAR(100) DEFAULT 'fa-cog',
                    image_url VARCHAR(500),
                    display_order INT DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )`,
                `CREATE TABLE IF NOT EXISTS news (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    title_en VARCHAR(255) NOT NULL,
                    title_am VARCHAR(255) NOT NULL,
                    description_en TEXT NOT NULL,
                    description_am TEXT NOT NULL,
                    category_en VARCHAR(50) DEFAULT 'Transport',
                    category_am VARCHAR(50) DEFAULT 'ትራንስፖርት',
                    image_url VARCHAR(500),
                    date DATE,
                    is_published BOOLEAN DEFAULT TRUE,
                    views INT DEFAULT 0,
                    created_by VARCHAR(100),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )`,
                `CREATE TABLE IF NOT EXISTS announcements (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    title_en VARCHAR(255) NOT NULL,
                    title_am VARCHAR(255) NOT NULL,
                    description_en TEXT NOT NULL,
                    description_am TEXT NOT NULL,
                    type ENUM('announcement', 'vacancy', 'media', 'event') DEFAULT 'announcement',
                    type_en VARCHAR(50) DEFAULT 'Announcement',
                    type_am VARCHAR(50) DEFAULT 'ማስታወቂያ',
                    attachment_url VARCHAR(500),
                    date DATE,
                    is_published BOOLEAN DEFAULT TRUE,
                    created_by VARCHAR(100),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )`,
                `CREATE TABLE IF NOT EXISTS contact_messages (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    first_name VARCHAR(100) NOT NULL,
                    last_name VARCHAR(100) NOT NULL,
                    email VARCHAR(255) NOT NULL,
                    phone VARCHAR(50),
                    subject VARCHAR(255),
                    title VARCHAR(255),
                    message TEXT NOT NULL,
                    attachment_url VARCHAR(500),
                    is_read BOOLEAN DEFAULT FALSE,
                    replied BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`,
                `CREATE TABLE IF NOT EXISTS admin_users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(50) UNIQUE NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    full_name VARCHAR(255),
                    email VARCHAR(255),
                    role ENUM('super_admin', 'admin', 'editor') DEFAULT 'admin',
                    is_active BOOLEAN DEFAULT TRUE,
                    last_login TIMESTAMP NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`,
                `CREATE TABLE IF NOT EXISTS settings (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    setting_key VARCHAR(100) UNIQUE NOT NULL,
                    setting_value_en TEXT,
                    setting_value_am TEXT,
                    setting_type VARCHAR(50) DEFAULT 'text',
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )`,
                `CREATE TABLE IF NOT EXISTS statistics (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    stat_key VARCHAR(50) UNIQUE NOT NULL,
                    stat_value VARCHAR(255) NOT NULL,
                    label_en VARCHAR(100),
                    label_am VARCHAR(100),
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )`
            ];

            for (const sql of tables) await this.db.run(sql);

            // Default admin (username: admin, password: admin123)
            const adminExists = await this.db.get("SELECT * FROM admin_users WHERE username = 'admin'");
            if (!adminExists) {
                const hashedPassword = await bcrypt.hash('admin123', 10);
                await this.db.run(
                    `INSERT INTO admin_users (username, password, full_name, email, role) 
                     VALUES (?, ?, ?, ?, ?)`,
                    ['admin', hashedPassword, 'System Administrator', 'admin@hadiyatransport.gov.et', 'super_admin']
                );
            }

            // Default settings
            const defaultSettings = [
                { key: 'site_title', value_en: 'Hadiya Zone Transport Bureau', value_am: 'ሀዲያ ዞን ትራንስፖርት ቢሮ' },
                { key: 'contact_phone', value_en: '+251-46-112-2334', value_am: null },
                { key: 'contact_email', value_en: 'info@hadiyatransport.gov.et', value_am: null },
                { key: 'contact_address', value_en: 'Hosaena, Ethiopia', value_am: 'ሆሳዕና፣ ኢትዮጵያ' }
            ];
            for (const s of defaultSettings) {
                await this.db.run(
                    `INSERT IGNORE INTO settings (setting_key, setting_value_en, setting_value_am) VALUES (?, ?, ?)`,
                    [s.key, s.value_en, s.value_am]
                );
            }

            // Default statistics
            const defaultStats = [
                { key: 'vehicles', value: '5000', label_en: 'Vehicles', label_am: 'ተሽከርካሪዎች' },
                { key: 'employees', value: '340', label_en: 'Employees', label_am: 'ሰራተኞች' },
                { key: 'mass_transport', value: '20330', label_en: 'Mass Transport', label_am: 'ጅምላ ትራንስፖርት' }
            ];
            for (const s of defaultStats) {
                await this.db.run(
                    `INSERT IGNORE INTO statistics (stat_key, stat_value, label_en, label_am) VALUES (?, ?, ?, ?)`,
                    [s.key, s.value, s.label_en, s.label_am]
                );
            }

            // Sample data
            await this.db.run(
                `INSERT IGNORE INTO leaders (name, title_en, title_am, description_en, description_am, display_order) 
                 VALUES ('Ato Gediyon', 'Bureau Head', 'የቢሮ ኃላፊ', 'Experienced leader in transport sector.', 'በትራንስፖርት ዘርፍ ልምድ ያለው መሪ።', 1)`
            );
            await this.db.run(
                `INSERT IGNORE INTO services (title_en, title_am, description_en, description_am, icon) 
                 VALUES ('Public Transport', 'የህዝብ ትራንስፖርት', 'Reliable and efficient public transport services.', 'አስተማማኝ እና ቀልጣፋ የህዝብ ትራንስፖርት አገልግሎት።', 'fa-bus')`
            );
            await this.db.run(
                `INSERT IGNORE INTO news (title_en, title_am, description_en, description_am, category_en, category_am, created_by) 
                 VALUES ('Welcome to New Website', 'አዲሱ ድረ-ገጻችንን እንኳን ደህና መጡ', 'We are excited to launch our new digital platform.', 'አዲሱን ዲጂታል መድረካችንን በማስጀመር ደስተኞች ነን።', 'Announcement', 'ማስታወቂያ', 'system')`
            );

            res.send(`
                <!DOCTYPE html>
                <html>
                <head><title>Installation Success</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: linear-gradient(135deg, #1e78ff, #061e29); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
                    .card { background: white; border-radius: 20px; padding: 50px; max-width: 600px; text-align: center; }
                    h1 { color: #1e78ff; margin-bottom: 20px; }
                    .btn { display: inline-block; padding: 12px 25px; background: #1e78ff; color: white; text-decoration: none; border-radius: 8px; margin: 10px; }
                </style>
                </head>
                <body>
                    <div class="card">
                        <h1>✅ Installation Successful</h1>
                        <p>All tables created and default data inserted.</p>
                        <p><strong>Admin Login:</strong> admin / admin123</p>
                        <a href="/admin" class="btn">Go to Admin Panel</a>
                        <a href="/" class="btn" style="background: #6b7280;">Go to Homepage</a>
                    </div>
                </body>
                </html>
            `);
        } catch (error) {
            console.error("Installation error:", error);
            res.status(500).send(`Installation failed: ${error.message}`);
        }
    }
}

// ======================== MAIN APP CLASS ========================
class App {
    constructor() {
        this.app = express();
        this.db = new Database();
        this.uploadService = new UploadService();
        this.authService = new AuthService(this.db);
        this.adminController = new AdminController(this.db, this.uploadService, this.authService);
        this.publicApiController = new PublicApiController(this.db);
        this.installController = new InstallController(this.db);

        this.configureMiddleware();
        this.configureRoutes();
        this.configureErrorHandling();
    }

    configureMiddleware() {
        this.app.use(express.urlencoded({ extended: true }));
        this.app.use(express.json());

        this.app.use(session({
            secret: process.env.SESSION_SECRET || 'hadiya-transport-secret-2025',
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: process.env.NODE_ENV === 'production',
                maxAge: 24 * 60 * 60 * 1000
            }
        }));

        // Serve static files
        this.app.use(express.static(path.join(__dirname, '../frontend'))); // for SPA index.html
        this.app.use('/uploads', express.static(path.join(__dirname, './public/uploads')));
        this.app.use('/images', express.static(path.join(__dirname, './public/images')));
    }

    configureRoutes() {
        // ----- PUBLIC SPA -----
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../frontend/index.html'));
        });

        // ----- INSTALL -----
        this.app.get('/install', this.installController.install.bind(this.installController));

        // ----- PUBLIC API -----
        this.app.get('/api/settings', this.publicApiController.getSettings.bind(this.publicApiController));
        this.app.get('/api/statistics', this.publicApiController.getStatistics.bind(this.publicApiController));
        this.app.get('/api/leaders', this.publicApiController.getLeaders.bind(this.publicApiController));
        this.app.get('/api/leadership', this.publicApiController.getLeaders.bind(this.publicApiController));
        this.app.get('/api/services', this.publicApiController.getServices.bind(this.publicApiController));
        this.app.get('/api/news', this.publicApiController.getNews.bind(this.publicApiController));
        this.app.get('/api/news/:id', this.publicApiController.getNewsById.bind(this.publicApiController));
        this.app.get('/api/announcements', this.publicApiController.getAnnouncements.bind(this.publicApiController));
        this.app.post('/api/contact', this.uploadService.single('attachment'), this.publicApiController.submitContact.bind(this.publicApiController));
        this.app.post('/api/language', this.publicApiController.setLanguage.bind(this.publicApiController));
        this.app.get('/api/config', this.publicApiController.getConfig.bind(this.publicApiController));

        // ----- ADMIN AUTH -----
        this.app.get('/admin', this.getAdminLogin.bind(this));
        this.app.post('/admin/login', this.postAdminLogin.bind(this));
        this.app.get('/admin/logout', this.getAdminLogout.bind(this));

        // ----- ADMIN PANEL (Protected) -----
        this.app.get('/admin/dashboard', this.authService.requireAdmin, this.adminController.dashboard.bind(this.adminController));

        // Leaders
        this.app.get('/admin/leaders', this.authService.requireAdmin, this.adminController.listLeaders.bind(this.adminController));
        this.app.post('/admin/leaders/add', this.authService.requireAdmin, this.uploadService.single('image'), this.adminController.addLeader.bind(this.adminController));
        this.app.get('/admin/leaders/edit/:id', this.authService.requireAdmin, this.adminController.editLeader.bind(this.adminController));
        this.app.post('/admin/leaders/update/:id', this.authService.requireAdmin, this.uploadService.single('image'), this.adminController.updateLeader.bind(this.adminController));
        this.app.get('/admin/leaders/delete/:id', this.authService.requireAdmin, this.adminController.deleteLeader.bind(this.adminController));

        // Services
        this.app.get('/admin/services', this.authService.requireAdmin, this.adminController.listServices.bind(this.adminController));
        this.app.post('/admin/services/add', this.authService.requireAdmin, this.adminController.addService.bind(this.adminController));
        this.app.get('/admin/services/edit/:id', this.authService.requireAdmin, this.adminController.editService.bind(this.adminController));
        this.app.post('/admin/services/update/:id', this.authService.requireAdmin, this.adminController.updateService.bind(this.adminController));
        this.app.get('/admin/services/delete/:id', this.authService.requireAdmin, this.adminController.deleteService.bind(this.adminController));

        // News
        this.app.get('/admin/news', this.authService.requireAdmin, this.adminController.listNews.bind(this.adminController));
        this.app.post('/admin/news/add', this.authService.requireAdmin, this.uploadService.single('image'), this.adminController.addNews.bind(this.adminController));
        this.app.get('/admin/news/edit/:id', this.authService.requireAdmin, this.adminController.editNews.bind(this.adminController));
        this.app.post('/admin/news/update/:id', this.authService.requireAdmin, this.uploadService.single('image'), this.adminController.updateNews.bind(this.adminController));
        this.app.get('/admin/news/delete/:id', this.authService.requireAdmin, this.adminController.deleteNews.bind(this.adminController));

        // Announcements
        this.app.get('/admin/announcements', this.authService.requireAdmin, this.adminController.listAnnouncements.bind(this.adminController));
        this.app.post('/admin/announcements/add', this.authService.requireAdmin, this.uploadService.single('attachment'), this.adminController.addAnnouncement.bind(this.adminController));
        this.app.get('/admin/announcements/edit/:id', this.authService.requireAdmin, this.adminController.editAnnouncement.bind(this.adminController));
        this.app.post('/admin/announcements/update/:id', this.authService.requireAdmin, this.uploadService.single('attachment'), this.adminController.updateAnnouncement.bind(this.adminController));
        this.app.get('/admin/announcements/delete/:id', this.authService.requireAdmin, this.adminController.deleteAnnouncement.bind(this.adminController));

        // Statistics
        this.app.get('/admin/statistics', this.authService.requireAdmin, this.adminController.listStatistics.bind(this.adminController));
        this.app.post('/admin/statistics/update', this.authService.requireAdmin, this.adminController.updateStatistics.bind(this.adminController));

        // Messages
        this.app.get('/admin/messages', this.authService.requireAdmin, this.adminController.listMessages.bind(this.adminController));
        this.app.get('/admin/messages/:id', this.authService.requireAdmin, this.adminController.viewMessage.bind(this.adminController));
        this.app.get('/admin/messages/delete/:id', this.authService.requireAdmin, this.adminController.deleteMessage.bind(this.adminController));

        // Settings
        this.app.get('/admin/settings', this.authService.requireAdmin, this.adminController.listSettings.bind(this.adminController));
        this.app.post('/admin/settings/update', this.authService.requireAdmin, this.adminController.updateSettings.bind(this.adminController));

        // Admin Profile
        this.app.get('/admin/profile', this.authService.requireAdmin, this.adminController.adminProfile.bind(this.adminController));
        this.app.post('/admin/profile/update', this.authService.requireAdmin, this.adminController.updateAdminProfile.bind(this.adminController));
        this.app.post('/admin/profile/password', this.authService.requireAdmin, this.adminController.changeAdminPassword.bind(this.adminController));
    }

    configureErrorHandling() {
        // 404
        this.app.use((req, res) => {
            res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head><title>Page Not Found</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: linear-gradient(135deg, #1e78ff, #061e29); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
                    .card { background: white; border-radius: 20px; padding: 50px; max-width: 600px; text-align: center; }
                    h1 { color: #1e78ff; font-size: 3rem; margin-bottom: 20px; }
                    .btn { display: inline-block; padding: 12px 25px; background: #1e78ff; color: white; text-decoration: none; border-radius: 8px; }
                </style>
                </head>
                <body>
                    <div class="card"><h1>404</h1><p>The page you are looking for could not be found.</p><a href="/" class="btn">Go to Homepage</a></div>
                </body>
                </html>
            `);
        });

        // Error handler
        this.app.use((err, req, res, next) => {
            console.error(err.stack);
            res.status(500).send('Something broke!');
        });
    }

    async getAdminLogin(req, res) {
        if (req.session.admin) return res.redirect('/admin/dashboard');
        res.send(`<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Admin Login - Hadiya Transport</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Segoe UI', sans-serif; background: linear-gradient(135deg, #1e78ff, #061e29); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
                .login-card { background: white; border-radius: 20px; padding: 50px; max-width: 450px; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.2); }
                .logo { text-align: center; margin-bottom: 30px; }
                .logo i { font-size: 3.5rem; color: #1e78ff; }
                h1 { color: #1e78ff; font-size: 1.8rem; margin-bottom: 10px; text-align: center; }
                .form-group { margin-bottom: 20px; }
                label { display: block; margin-bottom: 8px; font-weight: 600; color: #333; }
                input { width: 100%; padding: 15px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: 16px; }
                .btn { width: 100%; padding: 15px; background: linear-gradient(to right, #1e78ff, #061e29); color: white; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; }
                .back-link { display: block; text-align: center; margin-top: 20px; color: #666; text-decoration: none; }
                .error-message { background: #fee2e2; color: #dc2626; padding: 15px; border-radius: 10px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
            </style>
        </head>
        <body>
            <div class="login-card">
                <div class="logo"><i class="fas fa-cogs"></i></div>
                <h1>Admin Panel</h1>
                <p>Hadiya Zone Transport Bureau</p>
                ${req.query.error ? '<div class="error-message"><i class="fas fa-exclamation-circle"></i> Invalid username or password</div>' : ''}
                <form action="/admin/login" method="POST">
                    <div class="form-group"><label for="username">Username</label><input type="text" id="username" name="username" required></div>
                    <div class="form-group"><label for="password">Password</label><input type="password" id="password" name="password" required></div>
                    <button type="submit" class="btn"><i class="fas fa-lock"></i> Login to Admin Panel</button>
                </form>
                <a href="/" class="back-link"><i class="fas fa-arrow-left"></i> Back to Website</a>
            </div>
        </body>
        </html>`);
    }

    async postAdminLogin(req, res) {
        const { username, password } = req.body;
        try {
            const admin = await this.authService.validateAdmin(username, password);
            if (admin) {
                req.session.admin = admin;
                await this.authService.updateLastLogin(admin.id);
                res.redirect('/admin/dashboard');
            } else {
                res.redirect('/admin?error=true');
            }
        } catch (error) {
            console.error("Admin login error:", error);
            res.redirect('/admin?error=true');
        }
    }

    getAdminLogout(req, res) {
        req.session.destroy();
        res.redirect('/admin');
    }

    start(port = process.env.PORT || 3016) {
        this.app.listen(port, '0.0.0.0', () => {
            console.log("\n🚀 =========================================");
            console.log("🏛️  HADIYA ZONE TRANSPORT BUREAU SYSTEM");
            console.log("===========================================");
            console.log(`📍 Website: http://localhost:${port}`);
            console.log(`🔧 Installation: http://localhost:${port}/install`);
            console.log(`⚙️  Admin Panel: http://localhost:${port}/admin`);
            console.log(`📧 Admin Login: admin / admin123`);
            console.log("===========================================\n");
        });
    }
}

// ======================== START THE APP ========================
const appInstance = new App();
appInstance.start();