import { describe, expect, it } from "vitest";

import {
  APPLICATION_STATUSES,
  APPLICATION_TONE,
  applicationToneClass,
  isAccepted,
  isApplicationStatus,
  isManualPaymentStatus,
  MANUAL_PAYMENT_STATUSES,
  PAYMENT_TONE,
  paymentToneClass,
  TONE_CLASS,
} from "./status";

describe("application status", () => {
  it("recognises the five application states and nothing else", () => {
    expect(APPLICATION_STATUSES).toEqual([
      "pending",
      "accepted",
      "waitlisted",
      "rejected",
      "withdrawn",
    ]);
    expect(isApplicationStatus("accepted")).toBe(true);
    expect(isApplicationStatus("withdrawn")).toBe(true);
    expect(isApplicationStatus("approved")).toBe(false);
    expect(isApplicationStatus("nonsense")).toBe(false);
  });

  it("gates stall assignment on accepted only", () => {
    expect(isAccepted("accepted")).toBe(true);
    expect(isAccepted("waitlisted")).toBe(false);
    expect(isAccepted("pending")).toBe(false);
    expect(isAccepted("withdrawn")).toBe(false);
  });
});

describe("colour coding (per Alison's request)", () => {
  it("maps application statuses to the requested tones", () => {
    expect(APPLICATION_TONE.accepted).toBe("green");
    expect(APPLICATION_TONE.waitlisted).toBe("yellow");
    expect(APPLICATION_TONE.rejected).toBe("red");
    expect(APPLICATION_TONE.pending).toBe("grey");
    expect(APPLICATION_TONE.withdrawn).toBe("grey");
    expect(applicationToneClass("accepted")).toBe(TONE_CLASS.green);
  });

  it("maps payment statuses to the requested tones", () => {
    expect(PAYMENT_TONE.paid).toBe("green");
    expect(PAYMENT_TONE.awaiting_payment).toBe("yellow");
    expect(PAYMENT_TONE.overdue).toBe("red");
    expect(PAYMENT_TONE.voided).toBe("grey");
    expect(paymentToneClass("paid")).toBe(TONE_CLASS.green);
  });
});

describe("manual payment statuses", () => {
  it("only admits the hand-settable subset", () => {
    expect(MANUAL_PAYMENT_STATUSES).toEqual(["awaiting_payment", "paid", "overdue", "voided"]);
    expect(isManualPaymentStatus("paid")).toBe(true);
    expect(isManualPaymentStatus("none")).toBe(false);
    expect(isManualPaymentStatus("invoicing")).toBe(false);
  });
});
