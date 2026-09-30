import { z } from "zod";

/**
 * Artist application — text fields only. Files (portfolio document + optional
 * insurance certificate) are validated separately in the submit route since
 * they require multipart/R2 handling.
 *
 * Yes/no and dropdown answers (applied-before, categories, stall preferences,
 * insurance, etc.) are validated as non-empty strings — the option lists are
 * owned by the public form, not this API. Stall preferences are stall slugs and
 * are resolved against `stall_options` at read time.
 */
export const ArtistFieldsSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().email(),
  appliedBefore: z.string().trim().min(1),
  brandName: z.string().trim().min(1),
  website: z.string().trim().min(1),
  instagram: z.string().trim().min(1),
  bio: z.string().trim().min(1),
  primaryCategory: z.string().trim().min(1),
  secondaryCategory: z.string().trim().min(1),
  productDescription: z.string().trim().min(1),
  additionalNotes: z.string().trim().optional(),
  firstStallPreference: z.string().trim().min(1),
  secondStallPreference: z.string().trim().min(1),
  offerMiniIfUnavailable: z.string().trim().min(1),
  sharingStall: z.string().trim().min(1),
  hasInsurance: z.string().trim().min(1),
  // The three stall agreements must all be ticked.
  consentDebut: z.literal(true),
  consentSharing: z.literal(true),
  consentSetupGuide: z.literal(true),
  // Shared-stall second artist ("buddy") — the form's conditional section only
  // sends these when `sharingStall` is "Yes", so all are optional here. Mirrors
  // the main applicant's text fields.
  secondFirstName: z.string().trim().min(1).optional(),
  secondLastName: z.string().trim().min(1).optional(),
  secondEmail: z.string().trim().email().optional(),
  secondAppliedBefore: z.string().trim().min(1).optional(),
  secondBrandName: z.string().trim().min(1).optional(),
  secondWebsite: z.string().trim().min(1).optional(),
  secondInstagram: z.string().trim().min(1).optional(),
  secondBio: z.string().trim().min(1).optional(),
  secondPrimaryCategory: z.string().trim().min(1).optional(),
  secondSecondaryCategory: z.string().trim().min(1).optional(),
  secondProductDescription: z.string().trim().min(1).optional(),
});

export type ArtistFields = z.infer<typeof ArtistFieldsSchema>;

// File upload constraints. The portfolio is one 1-page A4 document; insurance
// accepts zero or more documents. Both may be a PDF or image export.
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_DOC_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
];
