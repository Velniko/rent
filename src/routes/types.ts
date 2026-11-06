/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

import type { Hono } from 'hono'

export type WorkspaceApp = Hono<{ Bindings: CloudflareBindings; Variables: { user: any } }>
