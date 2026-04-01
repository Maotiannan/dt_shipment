"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const db_js_1 = require("../db.js");
async function main() {
    const sqlPath = node_path_1.default.resolve(process.cwd(), 'db/init.sql');
    const sql = node_fs_1.default.readFileSync(sqlPath, 'utf8');
    await db_js_1.pool.query('create extension if not exists pgcrypto;');
    await db_js_1.pool.query(sql);
    console.log('DB initialized.');
    await db_js_1.pool.end();
}
main().catch(async (err) => {
    console.error(err);
    await db_js_1.pool.end();
    process.exit(1);
});
