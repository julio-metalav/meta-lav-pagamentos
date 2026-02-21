#!/usr/bin/env node
/**
 * Redireciona para o script ESM real. O CI ou chamadas antigas usam e2e-full.js;
 * a lógica (incl. header x-pos-serial) está em e2e-full.mjs.
 */
const { execSync } = require("child_process");
const path = require("path");
const script = path.join(__dirname, "e2e-full.mjs");
execSync(`node "${script}"`, { stdio: "inherit", env: process.env });
