"use strict";

const express = require("express");
const compression = require("compression");
const path = require("path");
const { withCors } = require("./utils/respond");
const { requestContext } = require("./utils/observability");
const { ensureSchema } = require("./db/schema");
const { BUILD_TAG, PORT, SERVE_FRONTEND } = require("./utils/constants");

const healthRoutes = require("./routes/health");
const publicRoutes = require("./routes/public");
const ossRoutes = require("./routes/oss");
const authRoutes = require("./routes/auth");
const settingsRoutes = require("./routes/settings");
const patternsRoutes = require("./routes/patterns");
const inventoryRoutes = require("./routes/inventory");
const historyRoutes = require("./routes/history");
const aiRoutes = require("./routes/ai");

const app = express();
app.use((req, res, next) => {
  withCors(res);
  if (req.method === "OPTIONS") return res.status(200).send("");
  next();
});
app.use(express.json({ limit: "2mb" }));

app.use(compression());
app.use("/api", requestContext);

app.use(healthRoutes);
app.use(publicRoutes);
app.use(ossRoutes);
app.use(authRoutes);
app.use(settingsRoutes);
app.use(patternsRoutes);
app.use(inventoryRoutes);
app.use(historyRoutes);
app.use(aiRoutes);

if (SERVE_FRONTEND) {
  app.use(
    "/",
    express.static(path.join(__dirname, "..", "public"), {
      extensions: ["html"],
      setHeaders: (res, filePath) => {
        const base = path.basename(filePath || "");
        if (base === "app.js" || base === "styles.css") {
          res.setHeader("Cache-Control", "public, max-age=600, must-revalidate");
          return;
        }
        if (base === "index.html") {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );
}

async function startServer() {
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
}

module.exports = {
  startServer,
};
