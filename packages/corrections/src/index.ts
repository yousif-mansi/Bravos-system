export { CorrectionsValidationError } from "./domain/errors.ts";
export { createCorrectionServices } from "./application/corrections.ts";
export type { CorrectionServices, CorrectionsActorPort, CorrectionsRepository } from "./application/ports.ts";
export type {
  ReturnCorrectionReportingFact,
  ReturnCorrectionReportingReader,
  SaleCorrectionReportingFact,
  SaleCorrectionReportingReader,
} from "./application/reporting-ports.ts";
