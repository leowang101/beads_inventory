"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { sendJson } = require("../utils/respond");
const {
  OSS_REGION,
  OSS_BUCKET,
  OSS_UPLOAD_ENDPOINT,
  OSS_UPLOAD_CNAME,
  OSS_CDN_BASE_URL,
  getOssSts,
  buildUploadPrefix,
} = require("../services/ossSts");
const { withHandler } = require("../utils/observability");

const router = express.Router();

router.get("/api/oss/sts", requireAuth, withHandler("ossSts", async (req, res) => {
  try {
    const sts = await getOssSts();
    const uploadPrefix = buildUploadPrefix(req.user?.id);
    console.info("[OSS] sts ok", {
      userId: req.user?.id,
      bucket: OSS_BUCKET,
      endpoint: OSS_UPLOAD_ENDPOINT,
      cname: OSS_UPLOAD_CNAME,
      uploadPrefix,
      cdnBaseUrl: OSS_CDN_BASE_URL,
    });
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
    console.error("[OSS] sts failed", { userId: req.user?.id, message: e.message });
    sendJson(res, 502, { ok: false, message: e.message });
  }
}));

module.exports = router;
