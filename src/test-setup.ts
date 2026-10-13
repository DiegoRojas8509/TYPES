import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest runs with globals off, so RTL's automatic cleanup never registers.
afterEach(cleanup);
