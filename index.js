/**
 * 拼豆库存管理系统 - 多用户后端（Express + MySQL，可无DB降级为“仅访客本地模式”）
 *
 * 关键需求实现：
 * 1) 未登录：前端本地存储；后端仅提供 /api/public/palette（221色号列表）
 * 2) 注册：最多200个账号；新账号默认221色号库存=0
 * 3) 登录后：库存/历史/设置全部按用户隔离存MySQL
 * 4) AI识别：必须登录（requireAuth）
 */

"use strict";

try {
  require("dotenv").config({ path: require("path").join(__dirname, ".env") });
} catch (e) {
  // dotenv is optional; if not installed, ensure your process manager injects env vars.
}

const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const mysql = require("mysql2/promise");
const path = require("path");

const BUILD_TAG = "beads-multi-2025-12-15";
const MAX_PATTERN_CATEGORIES = 10;

const PORT = Number(process.env.PORT || 3000);
const SERVE_FRONTEND = String(process.env.SERVE_FRONTEND || "true").toLowerCase() !== "false";

const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASS = process.env.DB_PASS;
const DB_NAME = process.env.DB_NAME;
const DB_PORT = Number(process.env.DB_PORT || 3306);

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || "";
const DASHSCOPE_BASE_URL = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/api/v1";
const QWEN_VL_MODEL = process.env.QWEN_VL_MODEL || "qwen-vl-plus";

// ====== OSS (STS via ECS RAM Role) ======
const OSS_REGION = process.env.OSS_REGION || "oss-cn-beijing";
const OSS_BUCKET = process.env.OSS_BUCKET || "beads-patterns";
const OSS_UPLOAD_ENDPOINT = process.env.OSS_UPLOAD_ENDPOINT || process.env.OSS_UPLOAD_DOMAIN || "https://upload.leobeads.xyz";
const OSS_UPLOAD_CNAME = String(process.env.OSS_UPLOAD_CNAME || "true").toLowerCase() !== "false";
const OSS_CDN_BASE_URL = process.env.OSS_CDN_BASE_URL || process.env.OSS_CDN_DOMAIN || "https://img.leobeads.xyz";
const ECS_RAM_ROLE_NAME = process.env.ECS_RAM_ROLE_NAME || process.env.OSS_ROLE_NAME || "EcsOssRole";
const ECS_METADATA_BASE_URL = process.env.ECS_METADATA_BASE_URL || "http://100.100.100.200/latest/meta-data/ram/security-credentials";
const OSS_UPLOAD_PREFIX = process.env.OSS_UPLOAD_PREFIX || "patterns";

// ====== 色号列表（来自 系列_色号_色值对应.csv）======
const PALETTE_ALL = [
  { code: "A1", hex: "#FAF5CD", series: "A系列", isDefault: true },
  { code: "A2", hex: "#FCFED6", series: "A系列", isDefault: true },
  { code: "A3", hex: "#FCFF92", series: "A系列", isDefault: true },
  { code: "A4", hex: "#F7EC5C", series: "A系列", isDefault: true },
  { code: "A5", hex: "#FFE44B", series: "A系列", isDefault: true },
  { code: "A6", hex: "#FDA951", series: "A系列", isDefault: true },
  { code: "A7", hex: "#FA8C4F", series: "A系列", isDefault: true },
  { code: "A8", hex: "#F9E045", series: "A系列", isDefault: true },
  { code: "A9", hex: "#F99C5F", series: "A系列", isDefault: true },
  { code: "A10", hex: "#F47E36", series: "A系列", isDefault: true },
  { code: "A11", hex: "#FEDB99", series: "A系列", isDefault: true },
  { code: "A12", hex: "#FDA276", series: "A系列", isDefault: true },
  { code: "A13", hex: "#FEC667", series: "A系列", isDefault: true },
  { code: "A14", hex: "#F85842", series: "A系列", isDefault: true },
  { code: "A15", hex: "#FBF65E", series: "A系列", isDefault: true },
  { code: "A16", hex: "#FEFF97", series: "A系列", isDefault: true },
  { code: "A17", hex: "#FDE173", series: "A系列", isDefault: true },
  { code: "A18", hex: "#FCBF80", series: "A系列", isDefault: true },
  { code: "A19", hex: "#FD7E77", series: "A系列", isDefault: true },
  { code: "A20", hex: "#F9D66E", series: "A系列", isDefault: true },
  { code: "A21", hex: "#FAE393", series: "A系列", isDefault: true },
  { code: "A22", hex: "#EDF878", series: "A系列", isDefault: true },
  { code: "A23", hex: "#E1C9BD", series: "A系列", isDefault: true },
  { code: "A24", hex: "#F3F6A9", series: "A系列", isDefault: true },
  { code: "A25", hex: "#FFD785", series: "A系列", isDefault: true },
  { code: "A26", hex: "#FEC832", series: "A系列", isDefault: true },
  { code: "B1", hex: "#DFF139", series: "B系列", isDefault: true },
  { code: "B2", hex: "#64F343", series: "B系列", isDefault: true },
  { code: "B3", hex: "#9FF685", series: "B系列", isDefault: true },
  { code: "B4", hex: "#5FDF34", series: "B系列", isDefault: true },
  { code: "B5", hex: "#39E158", series: "B系列", isDefault: true },
  { code: "B6", hex: "#64E0A4", series: "B系列", isDefault: true },
  { code: "B7", hex: "#3FAE7C", series: "B系列", isDefault: true },
  { code: "B8", hex: "#1D9E54", series: "B系列", isDefault: true },
  { code: "B9", hex: "#2A5037", series: "B系列", isDefault: true },
  { code: "B10", hex: "#9AD1BA", series: "B系列", isDefault: true },
  { code: "B11", hex: "#627032", series: "B系列", isDefault: true },
  { code: "B12", hex: "#1A6E3D", series: "B系列", isDefault: true },
  { code: "B13", hex: "#C8E87D", series: "B系列", isDefault: true },
  { code: "B14", hex: "#ACE84C", series: "B系列", isDefault: true },
  { code: "B15", hex: "#305335", series: "B系列", isDefault: true },
  { code: "B16", hex: "#C0ED9C", series: "B系列", isDefault: true },
  { code: "B17", hex: "#9EB33E", series: "B系列", isDefault: true },
  { code: "B18", hex: "#E6ED4F", series: "B系列", isDefault: true },
  { code: "B19", hex: "#26B78E", series: "B系列", isDefault: true },
  { code: "B20", hex: "#CAEDCF", series: "B系列", isDefault: true },
  { code: "B21", hex: "#176268", series: "B系列", isDefault: true },
  { code: "B22", hex: "#0A4241", series: "B系列", isDefault: true },
  { code: "B23", hex: "#343B1A", series: "B系列", isDefault: true },
  { code: "B24", hex: "#E8FAA6", series: "B系列", isDefault: true },
  { code: "B25", hex: "#4E846D", series: "B系列", isDefault: true },
  { code: "B26", hex: "#907C35", series: "B系列", isDefault: true },
  { code: "B27", hex: "#D0E0AF", series: "B系列", isDefault: true },
  { code: "B28", hex: "#9EE5BB", series: "B系列", isDefault: true },
  { code: "B29", hex: "#C6DF5F", series: "B系列", isDefault: true },
  { code: "B30", hex: "#E3FBB1", series: "B系列", isDefault: true },
  { code: "B31", hex: "#B2E694", series: "B系列", isDefault: true },
  { code: "B32", hex: "#92AD60", series: "B系列", isDefault: true },
  { code: "C1", hex: "#FFFEE4", series: "C系列", isDefault: true },
  { code: "C2", hex: "#ABF8FE", series: "C系列", isDefault: true },
  { code: "C3", hex: "#9EE0F8", series: "C系列", isDefault: true },
  { code: "C4", hex: "#44CDFB", series: "C系列", isDefault: true },
  { code: "C5", hex: "#06ABE3", series: "C系列", isDefault: true },
  { code: "C6", hex: "#54A7E9", series: "C系列", isDefault: true },
  { code: "C7", hex: "#3977CC", series: "C系列", isDefault: true },
  { code: "C8", hex: "#0F52BD", series: "C系列", isDefault: true },
  { code: "C9", hex: "#3349C3", series: "C系列", isDefault: true },
  { code: "C10", hex: "#3DBBE3", series: "C系列", isDefault: true },
  { code: "C11", hex: "#2ADED3", series: "C系列", isDefault: true },
  { code: "C12", hex: "#1E334E", series: "C系列", isDefault: true },
  { code: "C13", hex: "#CDE7FE", series: "C系列", isDefault: true },
  { code: "C14", hex: "#D6FDFC", series: "C系列", isDefault: true },
  { code: "C15", hex: "#21C5C4", series: "C系列", isDefault: true },
  { code: "C16", hex: "#1858A2", series: "C系列", isDefault: true },
  { code: "C17", hex: "#02D1F3", series: "C系列", isDefault: true },
  { code: "C18", hex: "#213244", series: "C系列", isDefault: true },
  { code: "C19", hex: "#188690", series: "C系列", isDefault: true },
  { code: "C20", hex: "#1A70A9", series: "C系列", isDefault: true },
  { code: "C21", hex: "#BEDDFC", series: "C系列", isDefault: true },
  { code: "C22", hex: "#6BB1BB", series: "C系列", isDefault: true },
  { code: "C23", hex: "#C8E2F9", series: "C系列", isDefault: true },
  { code: "C24", hex: "#7EC5F9", series: "C系列", isDefault: true },
  { code: "C25", hex: "#A9E8E0", series: "C系列", isDefault: true },
  { code: "C26", hex: "#42ADD1", series: "C系列", isDefault: true },
  { code: "C27", hex: "#D0DEEF", series: "C系列", isDefault: true },
  { code: "C28", hex: "#BDCEED", series: "C系列", isDefault: true },
  { code: "C29", hex: "#364A89", series: "C系列", isDefault: true },
  { code: "D1", hex: "#ACB7EF", series: "D系列", isDefault: true },
  { code: "D2", hex: "#868DD3", series: "D系列", isDefault: true },
  { code: "D3", hex: "#3653AF", series: "D系列", isDefault: true },
  { code: "D4", hex: "#162C7E", series: "D系列", isDefault: true },
  { code: "D5", hex: "#B34EC6", series: "D系列", isDefault: true },
  { code: "D6", hex: "#B37BDC", series: "D系列", isDefault: true },
  { code: "D7", hex: "#8758A9", series: "D系列", isDefault: true },
  { code: "D8", hex: "#E3D2FE", series: "D系列", isDefault: true },
  { code: "D9", hex: "#D6BAF5", series: "D系列", isDefault: true },
  { code: "D10", hex: "#301A49", series: "D系列", isDefault: true },
  { code: "D11", hex: "#BCBAE2", series: "D系列", isDefault: true },
  { code: "D12", hex: "#DC99CE", series: "D系列", isDefault: true },
  { code: "D13", hex: "#B5038F", series: "D系列", isDefault: true },
  { code: "D14", hex: "#882893", series: "D系列", isDefault: true },
  { code: "D15", hex: "#2F1E8E", series: "D系列", isDefault: true },
  { code: "D16", hex: "#E2E4F0", series: "D系列", isDefault: true },
  { code: "D17", hex: "#C7D3F9", series: "D系列", isDefault: true },
  { code: "D18", hex: "#9A64B8", series: "D系列", isDefault: true },
  { code: "D19", hex: "#D8C2D9", series: "D系列", isDefault: true },
  { code: "D20", hex: "#9C34AD", series: "D系列", isDefault: true },
  { code: "D21", hex: "#940595", series: "D系列", isDefault: true },
  { code: "D22", hex: "#383995", series: "D系列", isDefault: true },
  { code: "D23", hex: "#FADBF8", series: "D系列", isDefault: true },
  { code: "D24", hex: "#768AE1", series: "D系列", isDefault: true },
  { code: "D25", hex: "#4950C2", series: "D系列", isDefault: true },
  { code: "D26", hex: "#D6C6EB", series: "D系列", isDefault: true },
  { code: "E1", hex: "#F6D4CB", series: "E系列", isDefault: true },
  { code: "E2", hex: "#FCC1DD", series: "E系列", isDefault: true },
  { code: "E3", hex: "#F6BDE8", series: "E系列", isDefault: true },
  { code: "E4", hex: "#E9639E", series: "E系列", isDefault: true },
  { code: "E5", hex: "#F1559F", series: "E系列", isDefault: true },
  { code: "E6", hex: "#EC4072", series: "E系列", isDefault: true },
  { code: "E7", hex: "#C63674", series: "E系列", isDefault: true },
  { code: "E8", hex: "#FDDBE9", series: "E系列", isDefault: true },
  { code: "E9", hex: "#E575C7", series: "E系列", isDefault: true },
  { code: "E10", hex: "#D33997", series: "E系列", isDefault: true },
  { code: "E11", hex: "#F7DAD4", series: "E系列", isDefault: true },
  { code: "E12", hex: "#F893BF", series: "E系列", isDefault: true },
  { code: "E13", hex: "#B5026A", series: "E系列", isDefault: true },
  { code: "E14", hex: "#FAD4BF", series: "E系列", isDefault: true },
  { code: "E15", hex: "#F5C9CA", series: "E系列", isDefault: true },
  { code: "E16", hex: "#FBF4EC", series: "E系列", isDefault: true },
  { code: "E17", hex: "#F7E3EC", series: "E系列", isDefault: true },
  { code: "E18", hex: "#FBCBDB", series: "E系列", isDefault: true },
  { code: "E19", hex: "#F6BBD1", series: "E系列", isDefault: true },
  { code: "E20", hex: "#D7C6CE", series: "E系列", isDefault: true },
  { code: "E21", hex: "#C09DA4", series: "E系列", isDefault: true },
  { code: "E22", hex: "#B58B9F", series: "E系列", isDefault: true },
  { code: "E23", hex: "#937D8A", series: "E系列", isDefault: true },
  { code: "E24", hex: "#DEBEE5", series: "E系列", isDefault: true },
  { code: "F1", hex: "#FF9280", series: "F系列", isDefault: true },
  { code: "F2", hex: "#F73D48", series: "F系列", isDefault: true },
  { code: "F3", hex: "#EF4D3E", series: "F系列", isDefault: true },
  { code: "F4", hex: "#F92B40", series: "F系列", isDefault: true },
  { code: "F5", hex: "#E30328", series: "F系列", isDefault: true },
  { code: "F6", hex: "#913635", series: "F系列", isDefault: true },
  { code: "F7", hex: "#911932", series: "F系列", isDefault: true },
  { code: "F8", hex: "#BB0126", series: "F系列", isDefault: true },
  { code: "F9", hex: "#E0677A", series: "F系列", isDefault: true },
  { code: "F10", hex: "#874628", series: "F系列", isDefault: true },
  { code: "F11", hex: "#6F321D", series: "F系列", isDefault: true },
  { code: "F12", hex: "#F8516D", series: "F系列", isDefault: true },
  { code: "F13", hex: "#F45C45", series: "F系列", isDefault: true },
  { code: "F14", hex: "#FCADB2", series: "F系列", isDefault: true },
  { code: "F15", hex: "#D50527", series: "F系列", isDefault: true },
  { code: "F16", hex: "#F8C0A9", series: "F系列", isDefault: true },
  { code: "F17", hex: "#E89B7D", series: "F系列", isDefault: true },
  { code: "F18", hex: "#D07E4A", series: "F系列", isDefault: true },
  { code: "F19", hex: "#BE454A", series: "F系列", isDefault: true },
  { code: "F20", hex: "#C69495", series: "F系列", isDefault: true },
  { code: "F21", hex: "#F2BBC6", series: "F系列", isDefault: true },
  { code: "F22", hex: "#F7C3D0", series: "F系列", isDefault: true },
  { code: "F23", hex: "#EC806D", series: "F系列", isDefault: true },
  { code: "F24", hex: "#E09DAF", series: "F系列", isDefault: true },
  { code: "F25", hex: "#E84854", series: "F系列", isDefault: true },
  { code: "G1", hex: "#FFE4D3", series: "G系列", isDefault: true },
  { code: "G2", hex: "#FCC6AC", series: "G系列", isDefault: true },
  { code: "G3", hex: "#F1C4A5", series: "G系列", isDefault: true },
  { code: "G4", hex: "#DCB387", series: "G系列", isDefault: true },
  { code: "G5", hex: "#E7B34E", series: "G系列", isDefault: true },
  { code: "G6", hex: "#F3A014", series: "G系列", isDefault: true },
  { code: "G7", hex: "#98503A", series: "G系列", isDefault: true },
  { code: "G8", hex: "#4B2B1C", series: "G系列", isDefault: true },
  { code: "G9", hex: "#E4B685", series: "G系列", isDefault: true },
  { code: "G10", hex: "#DA8C42", series: "G系列", isDefault: true },
  { code: "G11", hex: "#DAC898", series: "G系列", isDefault: true },
  { code: "G12", hex: "#FEC993", series: "G系列", isDefault: true },
  { code: "G13", hex: "#B2714B", series: "G系列", isDefault: true },
  { code: "G14", hex: "#8B684C", series: "G系列", isDefault: true },
  { code: "G15", hex: "#F6F8E3", series: "G系列", isDefault: true },
  { code: "G16", hex: "#F2D8C1", series: "G系列", isDefault: true },
  { code: "G17", hex: "#79544E", series: "G系列", isDefault: true },
  { code: "G18", hex: "#FFE4D6", series: "G系列", isDefault: true },
  { code: "G19", hex: "#DD7D41", series: "G系列", isDefault: true },
  { code: "G20", hex: "#A5452F", series: "G系列", isDefault: true },
  { code: "G21", hex: "#B38561", series: "G系列", isDefault: true },
  { code: "H1", hex: "#FBFBFB", series: "H系列", isDefault: true },
  { code: "H2", hex: "#FFFFFF", series: "H系列", isDefault: true },
  { code: "H3", hex: "#B4B4B4", series: "H系列", isDefault: true },
  { code: "H4", hex: "#878787", series: "H系列", isDefault: true },
  { code: "H5", hex: "#464648", series: "H系列", isDefault: true },
  { code: "H6", hex: "#2C2C2C", series: "H系列", isDefault: true },
  { code: "H7", hex: "#010101", series: "H系列", isDefault: true },
  { code: "H8", hex: "#E7D6DC", series: "H系列", isDefault: true },
  { code: "H9", hex: "#EFEDEE", series: "H系列", isDefault: true },
  { code: "H10", hex: "#ECEAEB", series: "H系列", isDefault: true },
  { code: "H11", hex: "#CDCDCD", series: "H系列", isDefault: true },
  { code: "H12", hex: "#FDF6EE", series: "H系列", isDefault: true },
  { code: "H13", hex: "#F4EFD1", series: "H系列", isDefault: true },
  { code: "H14", hex: "#CED7D4", series: "H系列", isDefault: true },
  { code: "H15", hex: "#98A6A6", series: "H系列", isDefault: true },
  { code: "H16", hex: "#1B1213", series: "H系列", isDefault: true },
  { code: "H17", hex: "#F0EEEF", series: "H系列", isDefault: true },
  { code: "H18", hex: "#FCFFF8", series: "H系列", isDefault: true },
  { code: "H19", hex: "#F2EEE5", series: "H系列", isDefault: true },
  { code: "H20", hex: "#96A09F", series: "H系列", isDefault: true },
  { code: "H21", hex: "#F8FBE6", series: "H系列", isDefault: true },
  { code: "H22", hex: "#CACADA", series: "H系列", isDefault: true },
  { code: "H23", hex: "#9B9C94", series: "H系列", isDefault: true },
  { code: "M1", hex: "#BBC6B6", series: "M系列", isDefault: true },
  { code: "M2", hex: "#909994", series: "M系列", isDefault: true },
  { code: "M3", hex: "#697E80", series: "M系列", isDefault: true },
  { code: "M4", hex: "#E0D4BC", series: "M系列", isDefault: true },
  { code: "M5", hex: "#D0CBAE", series: "M系列", isDefault: true },
  { code: "M6", hex: "#B0AA86", series: "M系列", isDefault: true },
  { code: "M7", hex: "#B0A796", series: "M系列", isDefault: true },
  { code: "M8", hex: "#AE8082", series: "M系列", isDefault: true },
  { code: "M9", hex: "#A88764", series: "M系列", isDefault: true },
  { code: "M10", hex: "#C6B2BB", series: "M系列", isDefault: true },
  { code: "M11", hex: "#9D7693", series: "M系列", isDefault: true },
  { code: "M12", hex: "#644B51", series: "M系列", isDefault: true },
  { code: "M13", hex: "#C79266", series: "M系列", isDefault: true },
  { code: "M14", hex: "#C37463", series: "M系列", isDefault: true },
  { code: "M15", hex: "#747D7A", series: "M系列", isDefault: true },
  { code: "P1", hex: "#F9F9F9", series: "P系列（珠光）", isDefault: false },
  { code: "P2", hex: "#ABABAB", series: "P系列（珠光）", isDefault: false },
  { code: "P3", hex: "#B6DBAF", series: "P系列（珠光）", isDefault: false },
  { code: "P4", hex: "#FEA2A3", series: "P系列（珠光）", isDefault: false },
  { code: "P5", hex: "#EB903F", series: "P系列（珠光）", isDefault: false },
  { code: "P6", hex: "#63CEA2", series: "P系列（珠光）", isDefault: false },
  { code: "P7", hex: "#E79273", series: "P系列（珠光）", isDefault: false },
  { code: "P8", hex: "#ECDB59", series: "P系列（珠光）", isDefault: false },
  { code: "P9", hex: "#DBD9DA", series: "P系列（珠光）", isDefault: false },
  { code: "P10", hex: "#DBC7EA", series: "P系列（珠光）", isDefault: false },
  { code: "P11", hex: "#F1E9D4", series: "P系列（珠光）", isDefault: false },
  { code: "P12", hex: "#E9EDEE", series: "P系列（珠光）", isDefault: false },
  { code: "P13", hex: "#ADCBF1", series: "P系列（珠光）", isDefault: false },
  { code: "P14", hex: "#337BAD", series: "P系列（珠光）", isDefault: false },
  { code: "P15", hex: "#668575", series: "P系列（珠光）", isDefault: false },
  { code: "P16", hex: "#FDC24E", series: "P系列（珠光）", isDefault: false },
  { code: "P17", hex: "#FDA42E", series: "P系列（珠光）", isDefault: false },
  { code: "P18", hex: "#FEBDA7", series: "P系列（珠光）", isDefault: false },
  { code: "P19", hex: "#FFDEE9", series: "P系列（珠光）", isDefault: false },
  { code: "P20", hex: "#FCBFD1", series: "P系列（珠光）", isDefault: false },
  { code: "P21", hex: "#E8BEC2", series: "P系列（珠光）", isDefault: false },
  { code: "P22", hex: "#DFAAA4", series: "P系列（珠光）", isDefault: false },
  { code: "P23", hex: "#A3656A", series: "P系列（珠光）", isDefault: false },
  { code: "Q1", hex: "#F2A5E8", series: "Q系列（温变）", isDefault: false },
  { code: "Q2", hex: "#E9EC91", series: "Q系列（温变）", isDefault: false },
  { code: "Q3", hex: "#FFFF00", series: "Q系列（温变）", isDefault: false },
  { code: "Q4", hex: "#FFEBFA", series: "Q系列（温变）", isDefault: false },
  { code: "Q5", hex: "#76CEDE", series: "Q系列（温变）", isDefault: false },
  { code: "R1", hex: "#D40E1F", series: "R系列（果冻）", isDefault: false },
  { code: "R2", hex: "#F13484", series: "R系列（果冻）", isDefault: false },
  { code: "R3", hex: "#FB852B", series: "R系列（果冻）", isDefault: false },
  { code: "R4", hex: "#F8ED33", series: "R系列（果冻）", isDefault: false },
  { code: "R5", hex: "#32C958", series: "R系列（果冻）", isDefault: false },
  { code: "R6", hex: "#1EBA93", series: "R系列（果冻）", isDefault: false },
  { code: "R7", hex: "#1D779C", series: "R系列（果冻）", isDefault: false },
  { code: "R8", hex: "#1960C8", series: "R系列（果冻）", isDefault: false },
  { code: "R9", hex: "#945AB1", series: "R系列（果冻）", isDefault: false },
  { code: "R10", hex: "#F8DA54", series: "R系列（果冻）", isDefault: false },
  { code: "R11", hex: "#FCECF7", series: "R系列（果冻）", isDefault: false },
  { code: "R12", hex: "#D8D4D3", series: "R系列（果冻）", isDefault: false },
  { code: "R13", hex: "#56534E", series: "R系列（果冻）", isDefault: false },
  { code: "R14", hex: "#A3E7DC", series: "R系列（果冻）", isDefault: false },
  { code: "R15", hex: "#78CEE7", series: "R系列（果冻）", isDefault: false },
  { code: "R16", hex: "#3FCDCE", series: "R系列（果冻）", isDefault: false },
  { code: "R17", hex: "#4E8379", series: "R系列（果冻）", isDefault: false },
  { code: "R18", hex: "#7DCA9C", series: "R系列（果冻）", isDefault: false },
  { code: "R19", hex: "#C8E664", series: "R系列（果冻）", isDefault: false },
  { code: "R20", hex: "#E3CCBA", series: "R系列（果冻）", isDefault: false },
  { code: "R21", hex: "#A17140", series: "R系列（果冻）", isDefault: false },
  { code: "R22", hex: "#6B372C", series: "R系列（果冻）", isDefault: false },
  { code: "R23", hex: "#F6BB6F", series: "R系列（果冻）", isDefault: false },
  { code: "R24", hex: "#F3C6C0", series: "R系列（果冻）", isDefault: false },
  { code: "R25", hex: "#C76A62", series: "R系列（果冻）", isDefault: false },
  { code: "R26", hex: "#D093BC", series: "R系列（果冻）", isDefault: false },
  { code: "R27", hex: "#E58EAE", series: "R系列（果冻）", isDefault: false },
  { code: "R28", hex: "#9F85CF", series: "R系列（果冻）", isDefault: false },
  { code: "T1", hex: "#FCFDFF", series: "T系列（透明）", isDefault: false },
  { code: "Y1", hex: "#FF6FB7", series: "Y系列（夜光）", isDefault: false },
  { code: "Y2", hex: "#FDB583", series: "Y系列（夜光）", isDefault: false },
  { code: "Y3", hex: "#D8FCA4", series: "Y系列（夜光）", isDefault: false },
  { code: "Y4", hex: "#91DAFB", series: "Y系列（夜光）", isDefault: false },
  { code: "Y5", hex: "#E987EA", series: "Y系列（夜光）", isDefault: false },
  { code: "Y6", hex: "#F7D4B8", series: "Y系列（夜光）", isDefault: false },
  { code: "Y7", hex: "#F1FA7D", series: "Y系列（夜光）", isDefault: false },
  { code: "Y8", hex: "#5EE88C", series: "Y系列（夜光）", isDefault: false },
  { code: "Y9", hex: "#F8F5FE", series: "Y系列（夜光）", isDefault: false },
];
const PALETTE_DEFAULT = PALETTE_ALL.filter(x => x.isDefault);
const NON_DEFAULT_SERIES = Array.from(new Set(PALETTE_ALL.filter(x => !x.isDefault).map(x => x.series)));


// ====== util ======
function sendJson(res, status, obj) {
  res.status(status).json(obj);
}

function withCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
}

function normUsername(v) {
  return String(v ?? "").trim();
}

function normPatternUrl(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.slice(0, 512);
}
function normPatternKey(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.slice(0, 512);
}

function categoryDisplayLength(v){
  let len = 0;
  const s = String(v ?? "");
  for(const ch of s){
    len += /[^\x00-\xff]/.test(ch) ? 2 : 1;
  }
  return len;
}

function normCategoryName(v){
  return String(v ?? "").trim();
}

function parseCategoryId(v){
  if(v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if(!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function isValidUsername(username) {
  return /^[A-Za-z0-9_\-\u4e00-\u9fa5]{3,32}$/.test(String(username || ""));
}

function newSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), String(salt), 100000, 32, "sha256").toString("hex");
}

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

function newBatchId(){
  // 用于把一次“消耗/补充”的多条明细归为同一条记录
  return "bh_" + Date.now().toString(36) + "_" + crypto.randomBytes(6).toString("hex");
}

function dbEnabled() {
  return !!(DB_HOST && DB_USER && DB_NAME);
}

let _pool = null;
function getPool() {
  if (!dbEnabled()) throw new Error("DB未配置：请设置 DB_HOST/DB_USER/DB_PASS/DB_NAME");
  if (_pool) return _pool;
  _pool = mysql.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    port: DB_PORT,
    connectionLimit: 10,
    charset: "utf8mb4",
  });
  return _pool;
}

async function safeQuery(sql, params) {
  const pool = getPool();
  return pool.query(sql, params);
}

async function withTransaction(fn){
  const pool = getPool();
  const conn = await pool.getConnection();
  try{
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  }catch(e){
    try{ await conn.rollback(); }catch{}
    throw e;
  }finally{
    try{ conn.release(); }catch{}
  }
}
function q(conn, sql, params){
  return conn.query(sql, params);
}


async function ensureSchema() {
  if (!dbEnabled()) {
    console.warn("[WARN] DB_* 环境变量未配置完整，后端将只提供访客模式所需的 public 接口。");
    return;
  }
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(64) NOT NULL UNIQUE,
      password_salt VARCHAR(64) NOT NULL,
      password_hash VARCHAR(128) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(64) PRIMARY KEY,
      user_id BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NULL,
      INDEX idx_user_id(user_id),
      CONSTRAINT fk_sessions_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 兼容老版本：sessions.expires_at 可能是 NOT NULL 且无默认值，做一次 schema 修正
  try {
    await safeQuery("ALTER TABLE sessions MODIFY expires_at TIMESTAMP NULL");
  } catch (e) {
    // 忽略：可能无权限或已是目标 schema
  }


  await pool.query(`
    CREATE TABLE IF NOT EXISTS palette (
      code VARCHAR(16) PRIMARY KEY,
      hex VARCHAR(16) NOT NULL DEFAULT '#CCCCCC',
      series VARCHAR(64) NOT NULL DEFAULT '',
      is_default TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 兼容老版本：palette 可能只有 code/hex，补齐 series / is_default
  try { await safeQuery("ALTER TABLE palette ADD COLUMN series VARCHAR(64) NOT NULL DEFAULT ''"); } catch (e) {}
  try { await safeQuery("ALTER TABLE palette ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0"); } catch (e) {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_inventory (
      user_id BIGINT NOT NULL,
      code VARCHAR(16) NOT NULL,
      qty INT NOT NULL DEFAULT 0,
      hex VARCHAR(16) NOT NULL DEFAULT '#CCCCCC',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, code),
      CONSTRAINT fk_inv_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id BIGINT NOT NULL,
      skey VARCHAR(64) NOT NULL,
      svalue VARCHAR(256) NOT NULL,
      PRIMARY KEY(user_id, skey),
      CONSTRAINT fk_settings_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_pattern_categories (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      name VARCHAR(32) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_category(user_id, name),
      INDEX idx_user_category_user(user_id),
      CONSTRAINT fk_pattern_category_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_removed_codes (
      user_id BIGINT NOT NULL,
      code VARCHAR(16) NOT NULL,
      removed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, code),
      CONSTRAINT fk_removed_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_history (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      user_id BIGINT NOT NULL,
      code VARCHAR(16) NOT NULL,
      htype VARCHAR(16) NOT NULL,
      qty INT NOT NULL,
      pattern VARCHAR(64) NULL,
      pattern_url VARCHAR(512) NULL,
      pattern_key VARCHAR(512) NULL,
      pattern_category_id BIGINT NULL,
      source VARCHAR(32) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_code_time(user_id, code, created_at),
      CONSTRAINT fk_history_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);


  // best-effort: 兼容旧库，为“拼豆记录”增加 batch_id（把一次操作的多条明细归并）
  try { await pool.query("ALTER TABLE user_history ADD COLUMN batch_id VARCHAR(64) NULL"); } catch (e) {}
  try { await pool.query("CREATE INDEX idx_user_history_user_batch ON user_history(user_id, batch_id)"); } catch (e) {}
  try { await pool.query("ALTER TABLE user_history ADD COLUMN pattern_url VARCHAR(512) NULL"); } catch (e) {}
  try { await pool.query("ALTER TABLE user_history ADD COLUMN pattern_key VARCHAR(512) NULL"); } catch (e) {}
  try { await pool.query("ALTER TABLE user_history ADD COLUMN pattern_category_id BIGINT NULL"); } catch (e) {}
  try { await pool.query("CREATE INDEX idx_history_user_category ON user_history(user_id, pattern_category_id)"); } catch (e) {}
  try { await pool.query("ALTER TABLE user_history ADD CONSTRAINT fk_history_pattern_category FOREIGN KEY(pattern_category_id) REFERENCES user_pattern_categories(id) ON DELETE SET NULL"); } catch (e) {}

  // seed global palette (all codes) - ignore duplicates
  if (PALETTE_ALL.length > 0) {
    const valuesSql = PALETTE_ALL.map(() => "(?, ?, ?, ?)").join(",");
    const params = PALETTE_ALL.flatMap(x => [
      String(x.code).toUpperCase(),
      String(x.hex).toUpperCase(),
      String(x.series || ""),
      x.isDefault ? 1 : 0,
    ]);
    await pool.query(
      "INSERT INTO palette(code, hex, series, is_default) VALUES " + valuesSql +
        " ON DUPLICATE KEY UPDATE hex=VALUES(hex), series=VALUES(series), is_default=VALUES(is_default)",
      params
    );
  }
}

async function getUserByToken(token) {
  const [rows] = await safeQuery(
    "SELECT s.user_id as id, u.username as username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND (s.expires_at IS NULL OR s.expires_at > NOW()) LIMIT 1",
    [token]
  );
  if (!rows || rows.length === 0) return null;
  return { id: rows[0].id, username: rows[0].username };
}

async function requireAuth(req, res, next) {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
    if (!token) return sendJson(res, 401, { ok: false, message: "请先登录" });
    const u = await getUserByToken(token);
    if (!u) return sendJson(res, 401, { ok: false, message: "登录已失效，请重新登录" });
    req.user = u;
    next();
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
}

async function createSession(userId) {
  const token = newToken();
  // 默认 30 天有效期（与 MySQL 老表 schema 兼容，避免 expires_at 无默认值报错）
  await safeQuery(
    "INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?, DATE_ADD(NOW(), INTERVAL 30 DAY))",
    [token, userId]
  );
  return token;
}

async function ensureUserDefaults(userId) {
  // seed inventory 221 with qty=0
  await safeQuery(
    `INSERT IGNORE INTO user_inventory(user_id, code, qty, hex)
     SELECT ?, p.code, 0, p.hex
     FROM palette p
     LEFT JOIN user_removed_codes r ON r.user_id=? AND r.code=p.code
     WHERE p.is_default=1 AND r.code IS NULL`,
    [userId, userId]
  );
  await safeQuery(
    `INSERT IGNORE INTO user_settings(user_id, skey, svalue) VALUES
     (?, 'criticalThreshold', '300')`,
    [userId]
  );
}

// ====== app ======
const app = express();
app.use((req, res, next) => {
  withCors(res);
  if (req.method === "OPTIONS") return res.status(200).send("");
  next();
});
app.use(express.json({ limit: "2mb" }));

// ---- idempotency（防止网络抖动/重复点击导致重复入库） ----
// 说明：
// - 优先使用前端传入的 x-idempotency-key（2分钟内相同 key 直接返回同结果）
// - /api/adjustBatch 还会额外基于 body hash 做短期去重，避免前端重复生成不同 key 时仍重复入库
const _idempoCache = new Map(); // key -> {ts:number, payload:any}
const IDEMPO_TTL_MS = 2 * 60 * 1000;

function _idempoKey(req){
  const k = req.get("x-idempotency-key");
  if(!k) return null;
  const s = String(k).slice(0, 128);
  if(!s) return null;
  return `${req.user.id}:${s}`;
}
function _idempoGet(key){
  if(!key) return null;
  const v = _idempoCache.get(key);
  if(!v) return null;
  if(Date.now() - v.ts > IDEMPO_TTL_MS){
    _idempoCache.delete(key);
    return null;
  }
  return v.payload;
}
function _idempoSet(key, payload){
  if(!key) return;
  _idempoCache.set(key, {ts: Date.now(), payload});
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

// ---- OSS STS (via ECS RAM Role) ----
let _ossStsCache = null; // {data:{...}, expireAt:number}

async function fetchEcsSts() {
  const base = String(ECS_METADATA_BASE_URL || "").replace(/\/+$/, "");
  const role = String(ECS_RAM_ROLE_NAME || "").trim();
  if (!base || !role) throw new Error("OSS STS 配置缺失");
  const url = `${base}/${encodeURIComponent(role)}`;
  const resp = await fetch(url, { method: "GET" });
  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`ECS 元数据请求失败（${resp.status}）`);
  }
  let data = null;
  try { data = JSON.parse(raw); } catch {}
  if (!data || (data.Code && data.Code !== "Success")) {
    throw new Error("ECS 元数据返回异常");
  }
  const accessKeyId = data.AccessKeyId;
  const accessKeySecret = data.AccessKeySecret;
  const securityToken = data.SecurityToken;
  const expiration = data.Expiration;
  if (!accessKeyId || !accessKeySecret || !securityToken || !expiration) {
    throw new Error("ECS 元数据缺少凭证字段");
  }
  return { accessKeyId, accessKeySecret, securityToken, expiration };
}

async function getOssSts() {
  const now = Date.now();
  if (_ossStsCache && _ossStsCache.expireAt && _ossStsCache.expireAt - now > 60 * 1000) {
    return _ossStsCache.data;
  }
  const data = await fetchEcsSts();
  const expireAt = Date.parse(data.expiration) || 0;
  _ossStsCache = { data, expireAt };
  return data;
}

function buildUploadPrefix(userId) {
  const base = String(OSS_UPLOAD_PREFIX || "patterns").replace(/^\/+|\/+$/g, "");
  const uid = String(userId || "").trim();
  return uid ? `${base}/${uid}/` : `${base}/`;
}

// ====== public ======
app.get("/api/health", (req, res) => {
  sendJson(res, 200, { ok: true, buildTag: BUILD_TAG, ts: new Date().toISOString() });
});

app.get("/api/public/palette", async (req, res) => {
  try {
    if (dbEnabled()) {
      const [rows] = await safeQuery("SELECT code, hex, series, is_default AS isDefault FROM palette ORDER BY code", []);
      if (rows && rows.length > 0) return sendJson(res, 200, { ok: true, data: rows, buildTag: BUILD_TAG });
    }
    const data = PALETTE_ALL.map(x => ({ code: x.code, hex: x.hex, series: x.series, isDefault: x.isDefault ? 1 : 0 }));
    sendJson(res, 200, { ok: true, data, buildTag: BUILD_TAG, fallback: true });
  } catch (e) {
    const data = PALETTE_ALL.map(x => ({ code: x.code, hex: x.hex, series: x.series, isDefault: x.isDefault ? 1 : 0 }));
    sendJson(res, 200, { ok: true, data, buildTag: BUILD_TAG, fallback: true, warn: e.message });
  }
});

// ====== oss sts ======
app.get("/api/oss/sts", requireAuth, async (req, res) => {
  try {
    const sts = await getOssSts();
    const uploadPrefix = buildUploadPrefix(req.user?.id);
    sendJson(res, 200, {
      ok: true,
      data: {
        region: OSS_REGION,
        bucket: OSS_BUCKET,
        endpoint: OSS_UPLOAD_ENDPOINT,
        cname: OSS_UPLOAD_CNAME,
        secure: true,
        accessKeyId: sts.accessKeyId,
        accessKeySecret: sts.accessKeySecret,
        securityToken: sts.securityToken,
        expiration: sts.expiration,
        uploadPrefix,
        cdnBaseUrl: OSS_CDN_BASE_URL,
      },
    });
  } catch (e) {
    sendJson(res, 502, { ok: false, message: e.message });
  }
});

// ====== auth ======
app.get("/api/me", requireAuth, (req, res) => {
  sendJson(res, 200, { ok: true, username: req.user.username, buildTag: BUILD_TAG });
});

app.post("/api/register", async (req, res) => {
  try {
    if (!dbEnabled()) return sendJson(res, 500, { ok: false, message: "服务端数据库未配置，无法注册账号" });

    const username = normUsername(req.body?.username);
    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || req.body?.password2 || "");

    if (!isValidUsername(username)) return sendJson(res, 400, { ok: false, message: "用户名需为 3~32 位（中英文/数字/下划线/短横线）" });
    if (!password || password.length < 6) return sendJson(res, 400, { ok: false, message: "密码至少 6 位" });
    if (password !== confirmPassword) return sendJson(res, 400, { ok: false, message: "两次密码不一致" });

    const [cntRows] = await safeQuery("SELECT COUNT(*) as c FROM users", []);
    const cnt = Number(cntRows?.[0]?.c || 0);
    if (cnt >= 1000) return sendJson(res, 400, { ok: false, message: "账号注册数量达到上限。" });

    const salt = newSalt();
    const pwdHash = hashPassword(password, salt);

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query(
        "INSERT INTO users(username, password_salt, password_hash) VALUES(?,?,?)",
        [username, salt, pwdHash]
      );
      const userId = r.insertId;

      await conn.query(
        `INSERT IGNORE INTO user_settings(user_id, skey, svalue) VALUES
         (?, 'criticalThreshold', '300')`,
        [userId]
      );


      // Seed default 221 colors into this user's cloud inventory (qty=0)
      await conn.query(
        `INSERT IGNORE INTO user_inventory(user_id, code, qty, hex)
         SELECT ?, p.code, 0, p.hex FROM palette p WHERE p.is_default=1`,
        [userId]
      );
      const token = newToken();
      await conn.query("INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?,DATE_ADD(NOW(), INTERVAL 30 DAY))", [token, userId]);

      await conn.commit();
      sendJson(res, 200, { ok: true, token, username, buildTag: BUILD_TAG });
    } catch (e) {
      await conn.rollback();
      sendJson(res, 400, { ok: false, message: e.message });
    } finally {
      conn.release();
    }
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    if (!dbEnabled()) return sendJson(res, 500, { ok: false, message: "服务端数据库未配置，无法登录" });
    const username = normUsername(req.body?.username);
    const password = String(req.body?.password || "");
    if (!username || !password) return sendJson(res, 400, { ok: false, message: "missing username/password" });

    const [rows] = await safeQuery(
      "SELECT id, username, password_salt, password_hash FROM users WHERE username=? LIMIT 1",
      [username]
    );
    if (!rows || rows.length === 0) return sendJson(res, 400, { ok: false, message: "用户名或密码错误" });

    const u = rows[0];
    const calc = hashPassword(password, u.password_salt);
    if (calc !== u.password_hash) return sendJson(res, 400, { ok: false, message: "用户名或密码错误" });

    await ensureUserDefaults(u.id);

    const token = await createSession(u.id);
    sendJson(res, 200, { ok: true, token, username: u.username, buildTag: BUILD_TAG });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});

app.post("/api/logout", requireAuth, async (req, res) => {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
    if (token) await safeQuery("DELETE FROM sessions WHERE token=?", [token]);
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});

// ====== data (auth) ======
app.get("/api/all", requireAuth, async (req, res) => {
  try {
    // Ensure this user has the full default palette in inventory (221 colors, qty=0)
    await ensureUserDefaults(req.user.id);

    const [rows] = await safeQuery(
      `SELECT 
         ui.code AS code,
         COALESCE(p.hex, ui.hex) AS hex,
         ui.qty AS qty,
         COALESCE(p.series, '') AS series,
         COALESCE(p.is_default, 0) AS isDefault
       FROM user_inventory ui
       LEFT JOIN palette p ON ui.code=p.code
       WHERE ui.user_id=?
       ORDER BY ui.code`,
      [req.user.id]
    );
// Frontend expects { ok: true, data: [...] }
    sendJson(res, 200, { ok: true, data: rows, buildTag: BUILD_TAG });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});

app.get("/api/settings", requireAuth, async (req, res) => {
  try {
    const [rows] = await safeQuery(
      "SELECT skey, svalue FROM user_settings WHERE user_id=?",
      [req.user.id]
    );
    const map = Object.create(null);
    (rows || []).forEach(r => map[r.skey] = r.svalue);
    sendJson(res, 200, {
      ok: true,
      criticalThreshold: Number(map.criticalThreshold ?? 300),
      buildTag: BUILD_TAG
    });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});

app.post("/api/settings", requireAuth, async (req, res) => {
  try {
    const critical = Number(req.body?.criticalThreshold);
    if (!Number.isInteger(critical) || critical <= 0) return sendJson(res, 400, { ok: false, message: "告急数量必须为正整数" });

    await safeQuery(
      "INSERT INTO user_settings(user_id, skey, svalue) VALUES(?,?,?) ON DUPLICATE KEY UPDATE svalue=VALUES(svalue)",
      [req.user.id, "criticalThreshold", String(critical)]
    );

    // 历史字段：remindThreshold 不再使用（保留不影响兼容），也可选择性清理
    // await safeQuery("DELETE FROM user_settings WHERE user_id=? AND skey='remindThreshold'", [req.user.id]);

    sendJson(res, 200, { ok: true, criticalThreshold: critical });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});

// ====== Pattern Categories ======
app.get("/api/patternCategories", requireAuth, async (req, res) => {
  try{
    const [rows] = await safeQuery(
      `SELECT id, name, created_at AS createdAt
       FROM user_pattern_categories
       WHERE user_id=?
       ORDER BY created_at ASC, id ASC`,
      [req.user.id]
    );
    sendJson(res, 200, { ok:true, data: rows });
  }catch(e){
    sendJson(res, 500, { ok:false, message: e.message });
  }
});

app.post("/api/patternCategories", requireAuth, async (req, res) => {
  try{
    const name = normCategoryName(req.body?.name);
    if(!name) return sendJson(res, 400, { ok:false, message:"请输入分类名称" });
    if(categoryDisplayLength(name) > 12){
      return sendJson(res, 400, { ok:false, message:"分类名称最多6个中文或12个英文" });
    }

    const [[countRow]] = await safeQuery(
      "SELECT COUNT(1) AS cnt FROM user_pattern_categories WHERE user_id=?",
      [req.user.id]
    );
    const cnt = Number(countRow?.cnt || 0);
    if(cnt >= MAX_PATTERN_CATEGORIES){
      return sendJson(res, 400, { ok:false, message:`最多只能创建${MAX_PATTERN_CATEGORIES}个分类` });
    }

    const [exists] = await safeQuery(
      "SELECT id FROM user_pattern_categories WHERE user_id=? AND name=? LIMIT 1",
      [req.user.id, name]
    );
    if(exists && exists.length > 0){
      return sendJson(res, 400, { ok:false, message:"分类已存在" });
    }

    const [result] = await safeQuery(
      "INSERT INTO user_pattern_categories(user_id, name) VALUES(?, ?)",
      [req.user.id, name]
    );
    sendJson(res, 200, { ok:true, id: result?.insertId, name });
  }catch(e){
    sendJson(res, 500, { ok:false, message: e.message });
  }
});

app.post("/api/patternCategoryDelete", requireAuth, async (req, res) => {
  try{
    const id = parseCategoryId(req.body?.id);
    if(!id) return sendJson(res, 400, { ok:false, message:"invalid id" });

    await withTransaction(async(conn)=>{
      await q(conn, "UPDATE user_history SET pattern_category_id=NULL WHERE user_id=? AND pattern_category_id=?", [req.user.id, id]);
      const [delRes] = await q(conn, "DELETE FROM user_pattern_categories WHERE user_id=? AND id=?", [req.user.id, id]);
      if(!delRes || delRes.affectedRows === 0){
        throw new Error("not found");
      }
    });

    sendJson(res, 200, { ok:true });
  }catch(e){
    if(String(e.message||"") === "not found"){
      return sendJson(res, 404, { ok:false, message:"分类不存在" });
    }
    sendJson(res, 500, { ok:false, message: e.message });
  }
});

app.post("/api/patternCategoryUpdate", requireAuth, async (req, res) => {
  try{
    const id = parseCategoryId(req.body?.id);
    const name = normCategoryName(req.body?.name);
    if(!id) return sendJson(res, 400, { ok:false, message:"invalid id" });
    if(!name) return sendJson(res, 400, { ok:false, message:"请输入分类名称" });
    if(categoryDisplayLength(name) > 12){
      return sendJson(res, 400, { ok:false, message:"分类名称最多6个中文或12个英文" });
    }

    const [[base]] = await safeQuery(
      "SELECT id, name FROM user_pattern_categories WHERE user_id=? AND id=? LIMIT 1",
      [req.user.id, id]
    );
    if(!base) return sendJson(res, 404, { ok:false, message:"分类不存在" });
    if(String(base.name || "") === name){
      return sendJson(res, 200, { ok:true });
    }

    const [exists] = await safeQuery(
      "SELECT id FROM user_pattern_categories WHERE user_id=? AND name=? AND id<>? LIMIT 1",
      [req.user.id, name, id]
    );
    if(exists && exists.length > 0){
      return sendJson(res, 400, { ok:false, message:"分类已存在" });
    }

    await safeQuery(
      "UPDATE user_pattern_categories SET name=? WHERE user_id=? AND id=?",
      [name, req.user.id, id]
    );
    sendJson(res, 200, { ok:true });
  }catch(e){
    sendJson(res, 500, { ok:false, message: e.message });
  }
});

app.post("/api/adjust", requireAuth, async (req, res) => {
  try {
    const code = String(req.body?.code || "").toUpperCase();
    const type = String(req.body?.type || "");
    const qty = Number(req.body?.qty);
    const pattern = req.body?.pattern ? String(req.body.pattern).slice(0, 64) : null;
    const patternUrlRaw = Object.prototype.hasOwnProperty.call(req.body || {}, "patternUrl")
      ? req.body?.patternUrl
      : null;
    const patternUrl = normPatternUrl(patternUrlRaw);
    const patternKeyRaw = Object.prototype.hasOwnProperty.call(req.body || {}, "patternKey")
      ? req.body?.patternKey
      : null;
    const patternKey = normPatternKey(patternKeyRaw);
    const patternCategoryRaw = req.body?.patternCategoryId;
    const source = req.body?.source ? String(req.body.source).slice(0, 32) : null;

    if (!code) return sendJson(res, 400, { ok: false, message: "missing code" });
    if (!["consume", "restock"].includes(type)) return sendJson(res, 400, { ok: false, message: "invalid type" });
    if (!Number.isFinite(qty) || qty <= 0) return sendJson(res, 400, { ok: false, message: "invalid qty" });

    let patternCategoryId = null;
    if(type === "consume"){
      const cid = parseCategoryId(patternCategoryRaw);
      if(patternCategoryRaw !== undefined && patternCategoryRaw !== null && patternCategoryRaw !== "" && !cid){
        return sendJson(res, 400, { ok:false, message:"invalid category" });
      }
      if(cid){
        const [[cat]] = await safeQuery(
          "SELECT id FROM user_pattern_categories WHERE user_id=? AND id=? LIMIT 1",
          [req.user.id, cid]
        );
        if(!cat) return sendJson(res, 400, { ok:false, message:"分类不存在" });
        patternCategoryId = cid;
      }
    }

    const delta = type === "consume" ? -Math.abs(Math.floor(qty)) : Math.abs(Math.floor(qty));

    // 校验色号是否存在于全局 palette；非默认色号必须先“按系列添加”到库存
    const [[p]] = await safeQuery(
      "SELECT hex, is_default AS isDefault FROM palette WHERE code=? LIMIT 1",
      [code]
    );
    if (!p) return sendJson(res, 400, { ok: false, message: "unknown code" });

    // 已删除的色号不允许直接调整（避免被自动补齐/重新写入）
    const [[rm]] = await safeQuery(
      "SELECT 1 AS ok FROM user_removed_codes WHERE user_id=? AND code=? LIMIT 1",
      [req.user.id, code]
    );
    if (rm) {
      return sendJson(res, 400, { ok: false, message: "该色号已被删除，请先在设置中重新添加色号" });
    }

    if (Number(p.isDefault) === 0) {
      const [[exists]] = await safeQuery(
        "SELECT 1 AS ok FROM user_inventory WHERE user_id=? AND code=? LIMIT 1",
        [req.user.id, code]
      );
      if (!exists) {
        return sendJson(res, 400, { ok: false, message: "该色号属于非默认系列，请先在设置中添加对应系列" });
      }
    } else {
      // 默认色号：缺失则自动补齐（qty=0）
      await safeQuery(
        "INSERT IGNORE INTO user_inventory(user_id, code, qty, hex) VALUES(?,?,0,?)",
        [req.user.id, code, String(p.hex || "#CCCCCC").toUpperCase()]
      );
    }

    await safeQuery(
      "UPDATE user_inventory SET qty = qty + ? WHERE user_id=? AND code=?",
      [delta, req.user.id, code]
    );
    const batchId = newBatchId();
    const finalPatternUrl = type === "consume" ? patternUrl : null;
    const finalPatternKey = type === "consume" ? patternKey : null;
    const finalPatternCategoryId = type === "consume" ? patternCategoryId : null;
    await safeQuery(
      "INSERT INTO user_history(user_id, code, htype, qty, pattern, pattern_url, pattern_key, pattern_category_id, source, batch_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
      [req.user.id, code, type, Math.abs(Math.floor(qty)), pattern, finalPatternUrl, finalPatternKey, finalPatternCategoryId, source, batchId]
    );
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});

app.post("/api/resetAll", requireAuth, async (req, res) => {
  try {
    // 全部色号数量归零 + 清空历史记录
    await safeQuery("UPDATE user_inventory SET qty=0 WHERE user_id=?", [req.user.id]);
    await safeQuery("DELETE FROM user_history WHERE user_id=?", [req.user.id]);

    // 移除所有非默认色号
    await safeQuery(
      "DELETE ui FROM user_inventory ui JOIN palette p ON ui.code=p.code WHERE ui.user_id=? AND p.is_default=0",
      [req.user.id]
    );

    // 清理该用户的幂等缓存，避免“重置后短时间内重复请求被误判为重复”
    try{
      const prefix = `${req.user.id}:`;
      for(const k of Array.from(_idempoCache.keys())){
        if(String(k).startsWith(prefix)) _idempoCache.delete(k);
      }
    }catch{}

    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});


app.post("/api/adjustBatch", requireAuth, async (req, res) => {
  try {
    // 1) 优先用 x-idempotency-key
    const __idemKey = _idempoKey(req);

    // 2) 再用 body hash 兜底（避免前端重复生成不同 key 时仍重复入库）
    const __bodyHash = crypto.createHash("sha256").update(JSON.stringify(req.body||{})).digest("hex").slice(0, 32);
    const __hashKey = `${req.user.id}:hash:${__bodyHash}`;

    let __cached = null;
    if(__idemKey){
      __cached = _idempoGet(__idemKey);
    }else{
      __cached = _idempoGet(__hashKey);
    }
    if(__cached) return sendJson(res, 200, __cached);

    const typeDefault = String(req.body?.type || "");
    const patternDefault = req.body?.pattern ? String(req.body.pattern).slice(0, 64) : null;
    const patternUrlDefault = Object.prototype.hasOwnProperty.call(req.body || {}, "patternUrl")
      ? req.body?.patternUrl
      : null;
    const patternKeyDefault = Object.prototype.hasOwnProperty.call(req.body || {}, "patternKey")
      ? req.body?.patternKey
      : null;
    const hasPatternCategoryDefault = Object.prototype.hasOwnProperty.call(req.body || {}, "patternCategoryId");
    const patternCategoryDefaultRaw = hasPatternCategoryDefault ? req.body?.patternCategoryId : null;
    const sourceDefault = req.body?.source ? String(req.body.source).slice(0, 32) : null;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!items.length) return sendJson(res, 400, { ok: false, message: "empty" });
    if (items.length > 500) return sendJson(res, 400, { ok: false, message: "too many items" });

    // Normalize & validate
    const normalized = [];
    const categoryIdSet = new Set();
    for (const it of items) {
      const code = String(it?.code || "").toUpperCase();
      const qty = Number(it?.qty);
      const type = String(it?.type || typeDefault || "");
      const pattern = it?.pattern ? String(it.pattern).slice(0, 64) : patternDefault;
      const patternUrlRaw = Object.prototype.hasOwnProperty.call(it || {}, "patternUrl")
        ? it?.patternUrl
        : patternUrlDefault;
      const patternUrl = normPatternUrl(patternUrlRaw);
      const patternKeyRaw = Object.prototype.hasOwnProperty.call(it || {}, "patternKey")
        ? it?.patternKey
        : patternKeyDefault;
      const patternKey = normPatternKey(patternKeyRaw);
      const patternCategoryRaw = Object.prototype.hasOwnProperty.call(it || {}, "patternCategoryId")
        ? it?.patternCategoryId
        : patternCategoryDefaultRaw;
      const source = it?.source ? String(it.source).slice(0, 32) : sourceDefault;

      if (!code) return sendJson(res, 400, { ok: false, message: "missing code" });
      if (!["consume", "restock"].includes(type)) return sendJson(res, 400, { ok: false, message: "invalid type" });
      if (!Number.isFinite(qty) || qty <= 0) return sendJson(res, 400, { ok: false, message: "invalid qty" });

      let patternCategoryId = null;
      if(type === "consume"){
        const cid = parseCategoryId(patternCategoryRaw);
        if(patternCategoryRaw !== undefined && patternCategoryRaw !== null && patternCategoryRaw !== "" && !cid){
          return sendJson(res, 400, { ok:false, message:"invalid category" });
        }
        if(cid){
          patternCategoryId = cid;
          categoryIdSet.add(cid);
        }
      }

      normalized.push({
        code,
        qty: Math.abs(Math.floor(qty)),
        type,
        pattern,
        patternUrl: type === "consume" ? patternUrl : null,
        patternKey: type === "consume" ? patternKey : null,
        patternCategoryId: type === "consume" ? patternCategoryId : null,
        source,
      });
    }

    if(categoryIdSet.size > 0){
      const ids = Array.from(categoryIdSet.values());
      const inPh = ids.map(()=>"?").join(",");
      const [rows] = await safeQuery(
        `SELECT id FROM user_pattern_categories WHERE user_id=? AND id IN (${inPh})`,
        [req.user.id, ...ids]
      );
      const found = new Set((rows||[]).map(r=>Number(r.id)));
      for(const id of ids){
        if(!found.has(id)){
          return sendJson(res, 400, { ok:false, message:"分类不存在" });
        }
      }
    }

    // Aggregate inventory delta per code
    const deltaByCode = new Map();
    for (const it of normalized) {
      const delta = it.type === "consume" ? -it.qty : it.qty;
      deltaByCode.set(it.code, (deltaByCode.get(it.code) || 0) + delta);
    }
    const codes = Array.from(deltaByCode.keys());

    // 校验：色号必须存在于 palette；非默认色号必须先“按系列添加”到库存
    {
      const inPh = codes.map(() => "?").join(",");
      const [pRows] = await safeQuery(
        `SELECT code, is_default AS isDefault FROM palette WHERE code IN (${inPh})`,
        codes
      );
      const pMap = new Map((pRows || []).map(r => [String(r.code).toUpperCase(), Number(r.isDefault)]));
      for (const c of codes) {
        if (!pMap.has(c)) return sendJson(res, 400, { ok: false, message: `unknown code: ${c}` });
      }

      // 已删除的色号禁止批量调整（避免被重新写入）
      {
        const rmPh = codes.map(() => "?").join(",");
        const [rmRows] = await safeQuery(
          `SELECT code FROM user_removed_codes WHERE user_id=? AND code IN (${rmPh})`,
          [req.user.id, ...codes]
        );
        if (rmRows && rmRows.length > 0) {
          return sendJson(res, 400, { ok: false, message: "包含已删除的色号，请先在设置中重新添加色号" });
        }
      }
      const nonDefaultCodes = codes.filter(c => pMap.get(c) === 0);
      if (nonDefaultCodes.length > 0) {
        const inPh2 = nonDefaultCodes.map(() => "?").join(",");
        const [invRows] = await safeQuery(
          `SELECT code FROM user_inventory WHERE user_id=? AND code IN (${inPh2})`,
          [req.user.id, ...nonDefaultCodes]
        );
        const invSet = new Set((invRows || []).map(r => String(r.code).toUpperCase()));
        for (const c of nonDefaultCodes) {
          if (!invSet.has(c)) {
            return sendJson(res, 400, { ok: false, message: "包含未添加到库存的非默认色号，请先在设置中添加对应系列" });
          }
        }
      }
    }

    const batchId = newBatchId();

    // One transaction, 3 SQLs total
    await withTransaction(async (conn) => {
      // Ensure inventory rows exist ONLY for default codes (INSERT IGNORE)
      {
        const inPh = codes.map(() => "?").join(",");
        const params = [req.user.id, ...codes];
        await q(conn,
          `INSERT IGNORE INTO user_inventory(user_id, code, qty, hex)
           SELECT ?, p.code, 0, p.hex
           FROM palette p
           WHERE p.is_default=1 AND p.code IN (${inPh})`,
          params
        );
      }

      // Update inventory in one statement
      {
        const cases = [];
        const params = [];
        for (const [code, delta] of deltaByCode.entries()) {
          cases.push("WHEN ? THEN ?");
          params.push(code, delta);
        }
        const inPlaceholders = codes.map(() => "?").join(",");
        const sql = `
          UPDATE user_inventory
          SET qty = qty + CASE code
            ${cases.join(" ")}
            ELSE 0
          END
          WHERE user_id = ? AND code IN (${inPlaceholders})
        `;
        params.push(req.user.id, ...codes);
        await q(conn, sql, params);
      }

      // Insert history rows (bulk)
      {
        const vals = [];
        const params = [];
        for (const it of normalized) {
          vals.push("(?,?,?,?,?,?,?,?,?,?)");
          params.push(req.user.id, it.code, it.type, it.qty, it.pattern, it.patternUrl, it.patternKey, it.patternCategoryId, it.source, batchId);
        }
        await q(conn, `INSERT INTO user_history(user_id, code, htype, qty, pattern, pattern_url, pattern_key, pattern_category_id, source, batch_id) VALUES ${vals.join(",")}`, params);
      }
    });

    const __payload = { ok: true };
    if(__idemKey){
      _idempoSet(__idemKey, __payload);
    }else{
      _idempoSet(__hashKey, __payload);
    }
    sendJson(res, 200, __payload);
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});

app.get("/api/history", requireAuth, async (req, res) => {
  try {
    const code = req.query?.code ? String(req.query.code).toUpperCase() : null;
    if (!code) return sendJson(res, 400, { ok: false, message: "missing code" });

    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 100)));

    // 当前余量
    const [[inv]] = await safeQuery(
      "SELECT qty AS remain FROM user_inventory WHERE user_id=? AND code=? LIMIT 1",
      [req.user.id, code]
    );

    // 明细：统一字段名，保持与访客模式一致：ts/type/qty/pattern/source
    const [rows] = await safeQuery(
      `SELECT UNIX_TIMESTAMP(created_at)*1000 AS ts, htype AS type, qty, pattern, pattern_url AS patternUrl, pattern_key AS patternKey, source
       FROM user_history
       WHERE user_id=? AND code=?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [req.user.id, code, limit]
    );

    // 汇总
    const [[sumRow]] = await safeQuery(
      `SELECT
         IFNULL(SUM(CASE WHEN htype='consume' THEN qty ELSE 0 END),0) AS totalConsume,
         IFNULL(SUM(CASE WHEN htype='restock' THEN qty ELSE 0 END),0) AS totalRestock
       FROM user_history
       WHERE user_id=? AND code=?`,
      [req.user.id, code]
    );

    sendJson(res, 200, {
      ok: true,
      remain: inv?.remain ?? 0,
      totalConsume: sumRow?.totalConsume ?? 0,
      totalRestock: sumRow?.totalRestock ?? 0,
      data: rows,
      buildTag: BUILD_TAG,
    });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});

// 消耗统计：按色号汇总消耗数量（仅展示消耗>0）
app.get("/api/consumeStats", requireAuth, async (req, res) => {
  try {
    const [rows] = await safeQuery(
      `SELECT h.code, SUM(h.qty) AS qty, p.hex
       FROM user_history h
       LEFT JOIN palette p ON p.code=h.code
       WHERE h.user_id=? AND h.htype='consume'
       GROUP BY h.code
       HAVING SUM(h.qty) > 0
       ORDER BY qty DESC, h.code ASC`,
      [req.user.id]
    );

    sendJson(res, 200, { ok: true, data: rows, buildTag: BUILD_TAG });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});


app.get("/api/recordGroups", requireAuth, async (req, res) => {
  try{
    const type = String(req.query?.type || "").toLowerCase();
    const onlyWithPattern = String(req.query?.onlyWithPattern || "") === "1";
    const rawCategory = req.query?.patternCategoryId;
    const categoryId = (type === "consume") ? parseCategoryId(rawCategory) : null;

    if(!["consume","restock"].includes(type)){
      return sendJson(res, 400, { ok:false, message:"invalid type" });
    }
    if(type === "consume" && rawCategory !== undefined && rawCategory !== null && rawCategory !== "" && !categoryId){
      return sendJson(res, 400, { ok:false, message:"invalid category" });
    }

    const patternClause = (type==="consume" && onlyWithPattern) ? " AND pattern IS NOT NULL AND pattern<>'' " : "";
    const categoryClause = (type==="consume" && categoryId) ? " AND pattern_category_id=? " : "";

    const [rows] = await safeQuery(
      `
      SELECT gid, ts, pattern, patternUrl, patternKey, patternCategoryId, total FROM (
        SELECT
          CONCAT('b:', batch_id) AS gid,
          UNIX_TIMESTAMP(MAX(created_at))*1000 AS ts,
          MAX(pattern) AS pattern,
          MAX(pattern_url) AS patternUrl,
          MAX(pattern_key) AS patternKey,
          MAX(pattern_category_id) AS patternCategoryId,
          SUM(qty) AS total,
          MAX(id) AS maxId
        FROM user_history
        WHERE user_id=? AND htype=? AND batch_id IS NOT NULL
        ${patternClause}
        ${categoryClause}
        GROUP BY batch_id

        UNION ALL

        SELECT
          CONCAT('i:', MIN(id)) AS gid,
          UNIX_TIMESTAMP(MAX(created_at))*1000 AS ts,
          MAX(pattern) AS pattern,
          MAX(pattern_url) AS patternUrl,
          MAX(pattern_key) AS patternKey,
          MAX(pattern_category_id) AS patternCategoryId,
          SUM(qty) AS total,
          MAX(id) AS maxId
        FROM user_history
        WHERE user_id=? AND htype=? AND batch_id IS NULL
        ${patternClause}
        ${categoryClause}
        GROUP BY created_at, IFNULL(pattern,''), IFNULL(source,''), IFNULL(pattern_category_id,0)
      ) t
      ORDER BY t.ts DESC, t.maxId DESC
      `,
      [
        req.user.id,
        type,
        ...(categoryClause ? [categoryId] : []),
        req.user.id,
        type,
        ...(categoryClause ? [categoryId] : [])
      ]
    );

    sendJson(res, 200, { ok:true, data: rows, buildTag: BUILD_TAG });
  }catch(e){
    sendJson(res, 500, { ok:false, message:e.message });
  }
});

app.get("/api/recordGroupDetail", requireAuth, async (req, res) => {
  try{
    const gid = String(req.query?.gid || "");
    const type = String(req.query?.type || "").toLowerCase();
    if(!gid) return sendJson(res, 400, { ok:false, message:"missing gid" });
    if(!["consume","restock"].includes(type)) return sendJson(res, 400, { ok:false, message:"invalid type" });

    if(gid.startsWith("b:")){
      const batchId = gid.slice(2);
      const [rows] = await safeQuery(
        `SELECT h.code, SUM(h.qty) AS qty, p.hex
         FROM user_history h
         LEFT JOIN palette p ON p.code=h.code
         WHERE h.user_id=? AND h.htype=? AND h.batch_id=?
         GROUP BY h.code
         ORDER BY qty DESC, h.code ASC`,
        [req.user.id, type, batchId]
      );
      return sendJson(res, 200, { ok:true, data: rows, buildTag: BUILD_TAG });
    }

    if(gid.startsWith("i:")){
      const anchorId = Number(gid.slice(2));
      if(!Number.isFinite(anchorId) || anchorId<=0){
        return sendJson(res, 400, { ok:false, message:"invalid gid" });
      }
      const [[base]] = await safeQuery(
        `SELECT created_at, IFNULL(pattern,'') AS patternKey, IFNULL(source,'') AS sourceKey, IFNULL(pattern_category_id,0) AS categoryKey
         FROM user_history
         WHERE user_id=? AND id=? AND htype=? LIMIT 1`,
        [req.user.id, anchorId, type]
      );
      if(!base) return sendJson(res, 404, { ok:false, message:"group not found" });

      const [rows] = await safeQuery(
        `SELECT h.code, SUM(h.qty) AS qty, p.hex
         FROM user_history h
         LEFT JOIN palette p ON p.code=h.code
         WHERE h.user_id=? AND h.htype=? AND h.batch_id IS NULL
           AND h.created_at=? AND IFNULL(h.pattern,'')=? AND IFNULL(h.source,'')=? AND IFNULL(h.pattern_category_id,0)=?
         GROUP BY h.code
         ORDER BY qty DESC, h.code ASC`,
        [req.user.id, type, base.created_at, base.patternKey, base.sourceKey, base.categoryKey]
      );
      return sendJson(res, 200, { ok:true, data: rows, buildTag: BUILD_TAG });
    }

    return sendJson(res, 400, { ok:false, message:"invalid gid" });
  }catch(e){
    sendJson(res, 500, { ok:false, message:e.message });
  }
});

app.post("/api/recordGroupUpdate", requireAuth, async (req, res) => {
  try{
    // Edit a grouped record: compute inventory delta (new - old) and rewrite group history.
    const gid = String(req.body?.gid || "");
    const type = String(req.body?.type || "").toLowerCase();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const hasPattern = Object.prototype.hasOwnProperty.call(req.body || {}, "pattern");
    const patternRaw = hasPattern ? String(req.body?.pattern || "") : "";
    const hasPatternUrl = Object.prototype.hasOwnProperty.call(req.body || {}, "patternUrl");
    const patternUrlRaw = hasPatternUrl ? req.body?.patternUrl : null;
    const hasPatternKey = Object.prototype.hasOwnProperty.call(req.body || {}, "patternKey");
    const patternKeyRaw = hasPatternKey ? req.body?.patternKey : null;
    const hasPatternCategoryId = Object.prototype.hasOwnProperty.call(req.body || {}, "patternCategoryId");
    const patternCategoryRaw = hasPatternCategoryId ? req.body?.patternCategoryId : null;

    if(!gid) return sendJson(res, 400, { ok:false, message:"missing gid" });
    if(!["consume","restock"].includes(type)) return sendJson(res, 400, { ok:false, message:"invalid type" });
    if(!items.length) return sendJson(res, 400, { ok:false, message:"empty items" });
    if(items.length > 500) return sendJson(res, 400, { ok:false, message:"too many items" });

    const normPattern = (val)=>{
      const s = (val === null || val === undefined) ? "" : String(val);
      const t = s.trim();
      return t ? t.slice(0, 64) : null;
    };
    const pattern = hasPattern ? normPattern(patternRaw) : null;
    const patternUrl = hasPatternUrl ? normPatternUrl(patternUrlRaw) : null;
    const patternKey = hasPatternKey ? normPatternKey(patternKeyRaw) : null;
    let patternCategoryId = null;
    if(type === "consume" && hasPatternCategoryId){
      const cid = parseCategoryId(patternCategoryRaw);
      if(patternCategoryRaw !== null && patternCategoryRaw !== undefined && patternCategoryRaw !== "" && !cid){
        return sendJson(res, 400, { ok:false, message:"invalid category" });
      }
      if(cid){
        const [[cat]] = await safeQuery(
          "SELECT id FROM user_pattern_categories WHERE user_id=? AND id=? LIMIT 1",
          [req.user.id, cid]
        );
        if(!cat) return sendJson(res, 400, { ok:false, message:"分类不存在" });
        patternCategoryId = cid;
      }
    }

    // Normalize items (merge same code)
    const newMap = new Map();
    for(const it of items){
      const code = String(it?.code || "").trim().toUpperCase();
      const qty = Number(it?.qty);
      if(!code) return sendJson(res, 400, { ok:false, message:"missing code" });
      if(!Number.isFinite(qty) || qty <= 0) return sendJson(res, 400, { ok:false, message:"invalid qty" });
      const n = Math.abs(Math.floor(qty));
      newMap.set(code, (newMap.get(code) || 0) + n);
    }
    const normalized = Array.from(newMap.entries()).map(([code, qty])=>({code, qty}));
    if(normalized.length === 0) return sendJson(res, 400, { ok:false, message:"empty items" });

    let whereSql = "";
    let whereParams = [];
    let batchId = null;
    let baseCreatedAt = null;
    let basePattern = null;
    let basePatternUrl = null;
    let baseSource = null;
    let basePatternKey = null;
    let basePatternCategoryId = null;
    let basePatternCategoryKey = 0;

    if(gid.startsWith("b:")){
      batchId = gid.slice(2);
      if(!batchId) return sendJson(res, 400, { ok:false, message:"invalid gid" });
      const [[base]] = await safeQuery(
        `SELECT MAX(created_at) AS created_at, MAX(pattern) AS pattern, MAX(pattern_url) AS pattern_url, MAX(pattern_key) AS pattern_key, MAX(source) AS source, MAX(pattern_category_id) AS pattern_category_id
         FROM user_history
         WHERE user_id=? AND htype=? AND batch_id=?`,
        [req.user.id, type, batchId]
      );
      if(!base || !base.created_at){
        return sendJson(res, 404, { ok:false, message:"group not found" });
      }
      baseCreatedAt = base.created_at;
      basePattern = base.pattern;
      basePatternUrl = base.pattern_url;
      baseSource = base.source;
      basePatternKey = base.pattern_key;
      basePatternCategoryId = base.pattern_category_id === null || base.pattern_category_id === undefined ? null : Number(base.pattern_category_id);
      basePatternCategoryKey = basePatternCategoryId ? Number(basePatternCategoryId) : 0;
      whereSql = " AND batch_id=? ";
      whereParams = [batchId];
    }else if(gid.startsWith("i:")){
      const anchorId = Number(gid.slice(2));
      if(!Number.isFinite(anchorId) || anchorId<=0){
        return sendJson(res, 400, { ok:false, message:"invalid gid" });
      }
      const [[base]] = await safeQuery(
        `SELECT created_at, IFNULL(pattern,'') AS patternNameKey, IFNULL(pattern_url,'') AS patternUrlKey, IFNULL(pattern_key,'') AS patternObjKey, IFNULL(source,'') AS sourceKey, IFNULL(pattern_category_id,0) AS categoryKey
         FROM user_history
         WHERE user_id=? AND id=? AND htype=? LIMIT 1`,
        [req.user.id, anchorId, type]
      );
      if(!base) return sendJson(res, 404, { ok:false, message:"group not found" });
      baseCreatedAt = base.created_at;
      basePattern = base.patternNameKey;
      basePatternUrl = base.patternUrlKey;
      baseSource = base.sourceKey;
      basePatternKey = base.patternObjKey;
      basePatternCategoryKey = Number(base.categoryKey) || 0;
      basePatternCategoryId = basePatternCategoryKey > 0 ? basePatternCategoryKey : null;
      whereSql = " AND batch_id IS NULL AND created_at=? AND IFNULL(pattern,'')=? AND IFNULL(source,'')=? AND IFNULL(pattern_category_id,0)=? ";
      whereParams = [baseCreatedAt, basePattern, baseSource, basePatternCategoryKey];
    }else{
      return sendJson(res, 400, { ok:false, message:"invalid gid" });
    }

    const [oldRows] = await safeQuery(
      `SELECT code, SUM(qty) AS qty
       FROM user_history
       WHERE user_id=? AND htype=? ${whereSql}
       GROUP BY code`,
      [req.user.id, type, ...whereParams]
    );
    if(!oldRows || oldRows.length===0){
      return sendJson(res, 404, { ok:false, message:"group not found" });
    }
    const oldMap = new Map((oldRows||[]).map(r=>[String(r.code).toUpperCase(), Number(r.qty)||0]));

    const codes = Array.from(newMap.keys());
    // Validate codes exist in palette and inventory
    if(codes.length>0){
      const inPh = codes.map(()=>"?").join(",");
      const [pRows] = await safeQuery(
        `SELECT code, is_default AS isDefault FROM palette WHERE code IN (${inPh})`,
        codes
      );
      const pMap = new Map((pRows||[]).map(r=>[String(r.code).toUpperCase(), Number(r.isDefault)]));
      for(const c of codes){
        if(!pMap.has(c)) return sendJson(res, 400, { ok:false, message:`unknown code: ${c}` });
      }

      // removed codes check
      {
        const rmPh = codes.map(()=>"?").join(",");
        const [rmRows] = await safeQuery(
          `SELECT code FROM user_removed_codes WHERE user_id=? AND code IN (${rmPh})`,
          [req.user.id, ...codes]
        );
        if(rmRows && rmRows.length>0){
          return sendJson(res, 400, { ok:false, message:"包含已删除的色号，请先在设置中重新添加色号" });
        }
      }

      const nonDefaultCodes = codes.filter(c=> pMap.get(c) === 0);
      if(nonDefaultCodes.length>0){
        const inPh2 = nonDefaultCodes.map(()=>"?").join(",");
        const [invRows] = await safeQuery(
          `SELECT code FROM user_inventory WHERE user_id=? AND code IN (${inPh2})`,
          [req.user.id, ...nonDefaultCodes]
        );
        const invSet = new Set((invRows||[]).map(r=>String(r.code).toUpperCase()));
        for(const c of nonDefaultCodes){
          if(!invSet.has(c)){
            return sendJson(res, 400, { ok:false, message:"包含未添加到库存的非默认色号，请先在设置中添加对应系列" });
          }
        }
      }
    }

    const unionCodes = Array.from(new Set([...oldMap.keys(), ...newMap.keys()]));
    const deltaEntries = [];
    for(const code of unionCodes){
      const oldQty = oldMap.get(code) || 0;
      const newQty = newMap.get(code) || 0;
      const diff = newQty - oldQty;
      if(diff === 0) continue;
      const delta = (type==="consume" ? -diff : diff);
      if(delta !== 0) deltaEntries.push({code, delta});
    }

    const finalPattern = (() => {
      const base = normPattern(basePattern);
      if(type !== "consume") return base;
      if(hasPattern) return pattern;
      return base;
    })();
    const finalPatternUrl = (() => {
      const base = normPatternUrl(basePatternUrl);
      if(type !== "consume") return base;
      if(hasPatternUrl) return patternUrl;
      return base;
    })();
    const finalPatternKey = (() => {
      const base = normPatternKey(basePatternKey);
      if(type !== "consume") return base;
      if(hasPatternKey) return patternKey;
      return base;
    })();
    const finalPatternCategoryId = (() => {
      if(type !== "consume") return null;
      if(hasPatternCategoryId) return patternCategoryId;
      return basePatternCategoryId;
    })();
    const finalSource = (() => {
      const s = (baseSource === null || baseSource === undefined) ? "" : String(baseSource);
      const t = s.trim();
      return t ? t.slice(0, 32) : null;
    })();
    const createdAt = baseCreatedAt || new Date();

    await withTransaction(async (conn)=>{
      // Ensure inventory rows for default codes
      if(codes.length>0){
        const inPh = codes.map(()=>"?").join(",");
        const params = [req.user.id, ...codes];
        await q(conn,
          `INSERT IGNORE INTO user_inventory(user_id, code, qty, hex)
           SELECT ?, p.code, 0, p.hex
           FROM palette p
           WHERE p.is_default=1 AND p.code IN (${inPh})`,
          params
        );
      }

      if(deltaEntries.length>0){
        const cases = deltaEntries.map(()=> "WHEN ? THEN ?").join(" ");
        const placeholders = deltaEntries.map(()=> "?").join(",");
        const params = [];
        for(const d of deltaEntries){
          params.push(d.code, d.delta);
        }
        params.push(req.user.id, ...deltaEntries.map(d=>d.code));
        await q(
          conn,
          `UPDATE user_inventory
           SET qty = qty + CASE code ${cases} ELSE 0 END
           WHERE user_id=? AND code IN (${placeholders})`,
          params
        );
      }

      await q(
        conn,
        `DELETE FROM user_history WHERE user_id=? AND htype=? ${whereSql}`,
        [req.user.id, type, ...whereParams]
      );

      // Preserve created_at/source so non-batch grouping keys remain stable.
      const vals = [];
      const params = [];
      for(const it of normalized){
        vals.push("(?,?,?,?,?,?,?,?,?,?,?)");
        params.push(req.user.id, it.code, type, it.qty, finalPattern, finalPatternUrl, finalPatternKey, finalPatternCategoryId, finalSource, batchId, createdAt);
      }
      await q(
        conn,
        `INSERT INTO user_history(user_id, code, htype, qty, pattern, pattern_url, pattern_key, pattern_category_id, source, batch_id, created_at)
         VALUES ${vals.join(",")}`,
        params
      );
    });

    sendJson(res, 200, { ok:true });
  }catch(e){
    sendJson(res, 500, { ok:false, message:e.message });
  }
});

app.post("/api/recordGroupDelete", requireAuth, async (req, res) => {
  try{
    const gid = String(req.body?.gid || "");
    const type = String(req.body?.type || "").toLowerCase();
    if(!gid) return sendJson(res, 400, { ok:false, message:"missing gid" });
    if(!["consume","restock"].includes(type)) return sendJson(res, 400, { ok:false, message:"invalid type" });

    const applyDeltaAndDelete = async (conn, whereSql, whereParams) => {
      const [rows] = await q(
        conn,
        `SELECT code, SUM(qty) AS qty FROM user_history WHERE user_id=? AND htype=? ${whereSql} GROUP BY code`,
        [req.user.id, type, ...whereParams]
      );

      if(!rows || rows.length===0) return;

      // build delta per code
      const deltas = rows.map(r => ({
        code: String(r.code).toUpperCase(),
        delta: (type==="consume" ? 1 : -1) * (Number(r.qty)||0)
      })).filter(x => x.delta !== 0);

      if(deltas.length){
        const cases = deltas.map(()=> "WHEN ? THEN ?").join(" ");
        const placeholders = deltas.map(()=> "?").join(",");
        const params = [];
        for(const d of deltas){
          params.push(d.code, d.delta);
        }
        params.push(req.user.id, ...deltas.map(d=>d.code));

        await q(
          conn,
          `UPDATE user_inventory
           SET qty = qty + CASE code ${cases} ELSE 0 END
           WHERE user_id=? AND code IN (${placeholders})`,
          params
        );
      }

      await q(
        conn,
        `DELETE FROM user_history WHERE user_id=? AND htype=? ${whereSql}`,
        [req.user.id, type, ...whereParams]
      );
    };

    await withTransaction(async(conn)=>{
      if(gid.startsWith("b:")){
        const batchId = gid.slice(2);
        await applyDeltaAndDelete(conn, " AND batch_id=? ", [batchId]);
        return;
      }
      if(gid.startsWith("i:")){
        const anchorId = Number(gid.slice(2));
        const [[base]] = await q(
          conn,
          `SELECT created_at, IFNULL(pattern,'') AS patternKey, IFNULL(source,'') AS sourceKey, IFNULL(pattern_category_id,0) AS categoryKey
           FROM user_history
           WHERE user_id=? AND id=? AND htype=? LIMIT 1`,
          [req.user.id, anchorId, type]
        );
        if(!base) throw new Error("group not found");
        await applyDeltaAndDelete(
          conn,
          " AND batch_id IS NULL AND created_at=? AND IFNULL(pattern,'')=? AND IFNULL(source,'')=? AND IFNULL(pattern_category_id,0)=? ",
          [base.created_at, base.patternKey, base.sourceKey, Number(base.categoryKey) || 0]
        );
        return;
      }
      throw new Error("invalid gid");
    });

    sendJson(res, 200, { ok:true });
  }catch(e){
    sendJson(res, 500, { ok:false, message:e.message });
  }
});


app.post("/api/addSeries", requireAuth, async (req, res) => {
  try {
    const series = String(req.body?.series || "").trim();
    if (!series) return sendJson(res, 400, { ok: false, message: "missing series" });
    if (!NON_DEFAULT_SERIES.includes(series)) {
      return sendJson(res, 400, { ok: false, message: "invalid series" });
    }

    await safeQuery(
      `INSERT IGNORE INTO user_inventory(user_id, code, qty, hex)
       SELECT ?, p.code, 0, p.hex
       FROM palette p
       LEFT JOIN user_removed_codes r ON r.user_id=? AND r.code=p.code
       WHERE p.series=? AND p.is_default=0 AND r.code IS NULL`,
      [req.user.id, req.user.id, series]
    );

    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});

app.post("/api/removeSeries", requireAuth, async (req, res) => {
  try {
    const series = String(req.body?.series || "").trim();
    if (!series) return sendJson(res, 400, { ok: false, message: "missing series" });
    if (!NON_DEFAULT_SERIES.includes(series)) {
      return sendJson(res, 400, { ok: false, message: "invalid series" });
    }

    // 删除该系列所有历史记录 + 移除库存行
    await safeQuery(
      `DELETE h FROM user_history h
       JOIN palette p ON h.code=p.code
       WHERE h.user_id=? AND p.series=? AND p.is_default=0`,
      [req.user.id, series]
    );
    await safeQuery(
      `DELETE ui FROM user_inventory ui
       JOIN palette p ON ui.code=p.code
       WHERE ui.user_id=? AND p.series=? AND p.is_default=0`,
      [req.user.id, series]
    );

    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});

// 添加色号（仅支持 MARD 色号）：库存为 0
app.post("/api/addColor", requireAuth, async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!code) return sendJson(res, 400, { ok: false, message: "missing code" });

    const [[p]] = await safeQuery(
      "SELECT code, hex FROM palette WHERE code=? LIMIT 1",
      [code]
    );
    if (!p) return sendJson(res, 400, { ok: false, message: "非MARD色号，请检查后重新输入" });

    const [[exists]] = await safeQuery(
      "SELECT 1 AS ok FROM user_inventory WHERE user_id=? AND code=? LIMIT 1",
      [req.user.id, code]
    );
    if (exists) return sendJson(res, 400, { ok: false, message: "色号已存在" });

    await safeQuery(
      "INSERT INTO user_inventory(user_id, code, qty, hex) VALUES(?,?,0,?)",
      [req.user.id, code, String(p.hex || "#CCCCCC").toUpperCase()]
    );
    // 如果之前被删除过，则清除删除标记
    await safeQuery(
      "DELETE FROM user_removed_codes WHERE user_id=? AND code=?",
      [req.user.id, code]
    );
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});

// 删除色号：清空库存 + 明细
app.post("/api/removeColor", requireAuth, async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!code) return sendJson(res, 400, { ok: false, message: "missing code" });

    // 仅允许删除 MARD 色号（与前端校验一致）
    const [[p]] = await safeQuery(
      "SELECT 1 AS ok FROM palette WHERE code=? LIMIT 1",
      [code]
    );
    if (!p) return sendJson(res, 400, { ok: false, message: "非MARD色号，请检查后重新输入" });

    await safeQuery("START TRANSACTION");
    await safeQuery("DELETE FROM user_history WHERE user_id=? AND code=?", [req.user.id, code]);
    await safeQuery("DELETE FROM user_inventory WHERE user_id=? AND code=?", [req.user.id, code]);
    await safeQuery(
      "INSERT INTO user_removed_codes(user_id, code, removed_at) VALUES(?,?,NOW()) ON DUPLICATE KEY UPDATE removed_at=NOW()",
      [req.user.id, code]
    );
    await safeQuery("COMMIT");

    sendJson(res, 200, { ok: true });
  } catch (e) {
    try { await safeQuery("ROLLBACK"); } catch {}
    sendJson(res, 500, { ok: false, message: e.message });
  }
});

// ====== AI识别（需要登录）=====
app.post("/api/recognize-pattern", requireAuth, upload.single("image"), async (req, res) => {
  try {
    if (!DASHSCOPE_API_KEY) return sendJson(res, 500, { ok: false, message: "DASHSCOPE_API_KEY 未配置" });
    if (!req.file) return sendJson(res, 400, { ok: false, message: "missing image" });

    const pattern = req.body?.pattern ? String(req.body.pattern).slice(0, 64) : "";
    const b64 = req.file.buffer.toString("base64");
    const dataUrl = `data:${req.file.mimetype};base64,${b64}`;

    // 提示词：要求输出严格 JSON（items）
        const prompt = [
      "你是一个严谨的视觉信息抽取助手。",
      "任务：从用户上传的拼豆图纸中，抽取“色号(code)”和“数量(qty)”。",
      "",
      "关键规则（用于避免干扰）：",
      "1) 这类图片通常包含两部分：上半部/主体是格子图案（每个格子里有色号），下半部/底部是“色号统计/用量统计/色号图例”（每个色号对应一个数量）；优先在图片底部约35%区域寻找统计区/图例；若找不到，再在右侧约35%区域寻找。",
      "2) 你必须【只】从“色号统计/用量统计/图例”区域读取数量；统计区通常表现为：色块+色号+数量，或“色号(数量)”/“色号 数量”的成排列表；【忽略】格子图案区域里重复出现的色号、行列坐标、标题、作者信息、水印与大字标语。",
      "3) 如果图片同时出现多个统计区域（例如顶部一排色号数量条、底部彩色标签列表），优先选择信息最完整、最清晰、最像“色号 + 数量”的统计列表；必要时可合并多个统计区域，但不得从格子区域统计。",
      "",
      "抽取与校验：",
      "- code 格式必须是：一个大写字母 + 1~2 位数字（例如 F11、A1、H23）。",
      "- qty 必须是正整数；常见写法可能是 “A1 1760”、 “B5 (96)”、或数字在色块下方/右侧。",
      "- 同一 code 若在统计区重复出现，请合并 qty（求和）；对不确定条目降低 confidence。",
      "",
      "输出要求（非常重要）：",
      "1) 只输出 JSON，不要任何额外解释、不要 Markdown。",
      "2) JSON 结构：{ \"items\": [ {\"code\":\"A1\",\"qty\":123,\"confidence\":0.0} ... ] }",
      "3) confidence 为 0~1 的小数，表示你对该条目的把握；清晰可读给 0.95~1，略模糊则降低；无法确认就不要输出该条，不要编造。",
      "",
      pattern ? `图纸名称（可参考但不强制）：${pattern}` : ""
    ].filter(Boolean).join("\n");

    const url = `${DASHSCOPE_BASE_URL.replace(/\/+$/, "")}/chat/completions`;
    const payload = {
      model: QWEN_VL_MODEL,
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: dataUrl } }, { type: "text", text: prompt }] }],
      temperature: 0.1,
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DASHSCOPE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const raw = await resp.text();
    if (!resp.ok) return sendJson(res, 502, { ok: false, message: "模型调用失败", status: resp.status, raw });

    let data = null;
    try { data = JSON.parse(raw); } catch {}
    const textOut = data?.choices?.[0]?.message?.content ?? raw;

    const parsed = extractJsonFromText(textOut);
    const items = sanitizeItems(parsed?.items || parsed?.data || parsed);

    sendJson(res, 200, { ok: true, items, buildTag: BUILD_TAG });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: e.message });
  }
});

function extractJsonFromText(s) {
  if (!s) return null;
  const str = String(s).trim();
  try { return JSON.parse(str); } catch {}
  const mObj = str.match(/\{[\s\S]*\}/);
  if (mObj) { try { return JSON.parse(mObj[0]); } catch {} }
  const mArr = str.match(/\[[\s\S]*\]/);
  if (mArr) { try { return JSON.parse(mArr[0]); } catch {} }
  return null;
}

function sanitizeItems(items) {
  const out = [];
  if (!items) return out;

  const arr = Array.isArray(items)
    ? items
    : (typeof items === "object"
        ? Object.entries(items).map(([code, qty]) => ({ code, qty }))
        : []);

  for (const it of arr) {
    const code = String(it.code ?? it[0] ?? "").toUpperCase().trim();
    const qty = Number(it.qty ?? it[1] ?? 0);

    // confidence 可能来自多种字段/格式
    let confRaw =
      it.confidence ?? it.conf ?? it.score ?? it.prob ?? it.p ?? it["置信度"] ?? it["可信度"];
    if (confRaw === "" || confRaw === undefined) confRaw = null;
    let confidence = confRaw === null ? null : Number(confRaw);
    if (Number.isFinite(confidence)) {
      // 兼容 0~100
      if (confidence > 1 && confidence <= 100) confidence = confidence / 100;
      // clamp
      if (confidence < 0) confidence = 0;
      if (confidence > 1) confidence = 1;
    } else {
      confidence = null;
    }

    if (!code) continue;
    if (!Number.isFinite(qty) || qty < 0) continue;

    out.push({
      code,
      qty: Math.floor(qty),
      // 若模型没返回 confidence，给一个温和默认值，避免前端一直显示 "-"
      confidence: confidence === null ? 0.8 : confidence,
    });
  }
  return out;
}

if (SERVE_FRONTEND) {
  app.use("/", express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
}

(async () => {
  try {
    await ensureSchema();
    console.log(`[${BUILD_TAG}] schema ok`);
  } catch (e) {
    console.error(`[${BUILD_TAG}] schema init failed:`, e.message);
  }

  app.listen(PORT, () => {
    console.log(`[${BUILD_TAG}] server listening on ${PORT}`);
    console.log(`- API health: http://127.0.0.1:${PORT}/api/health`);
  });
})();
