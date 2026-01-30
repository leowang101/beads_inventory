"use strict";

const express = require("express");
const multer = require("multer");
const { requireAuth } = require("../middleware/auth");
const { sendJson } = require("../utils/respond");
const {
  DASHSCOPE_API_KEY,
  DASHSCOPE_BASE_URL,
  QWEN_VL_MODEL,
  BUILD_TAG,
} = require("../utils/constants");
const { withHandler } = require("../utils/observability");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const router = express.Router();

// ====== AI识别（需要登录）=====
router.post("/api/recognize-pattern", requireAuth, upload.single("image"), withHandler("recognizePattern", async (req, res) => {
  try {
    if (!DASHSCOPE_API_KEY) return sendJson(res, 500, { ok: false, message: "DASHSCOPE_API_KEY 未配置" });
    if (!req.file) return sendJson(res, 400, { ok: false, message: "missing image" });
    if (!ALLOWED_IMAGE_TYPES.has(String(req.file.mimetype || ""))) {
      return sendJson(res, 400, { ok: false, message: "不支持的图片格式" });
    }

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
}));

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

module.exports = router;
