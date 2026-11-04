import cors from "cors";
import express from "express";
import helmet from "helmet";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { apiRouter } from "./routes/index";
import { logger } from "./utility/logger";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1); // Render runs behind a proxy

// Request log: method, url, status, time taken.
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    logger.info(req.method, req.originalUrl, res.statusCode, `${Date.now() - start}ms`);
  });
  next();
});

app.use(helmet());
app.use(cors({ origin: ["http://localhost:5173"], credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.use("/api", apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);