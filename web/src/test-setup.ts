import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Sin `globals: true`, Testing Library no desmonta solo entre tests.
afterEach(cleanup);
