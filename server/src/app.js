import express from "express";

const app = express();

// This module only composes the HTTP application. Keeping process startup in
// server.js lets tests import the real app without opening a port or contacting
// external services.

export { app };
