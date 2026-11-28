import type { IncomingMessage, ServerResponse } from 'http';
import { handlePayslipPdfRequest } from '../../server/payslipHandler.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await handlePayslipPdfRequest(req, res);
}
