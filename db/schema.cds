namespace supplier.mgmt;

using {
  cuid,
  managed
} from '@sap/cds/common';

/**
 * Lifecycle of an application.
 * DRAFT       -> created by the supplier, certificate not yet uploaded / not submitted
 * SUBMITTED   -> "Gönderildi"
 * IN_REVIEW   -> "İncelemede" (an approver opened the application)
 * APPROVED    -> "Sonuç: Onaylandı"
 * REJECTED    -> "Sonuç: Reddedildi" (supplier may re-apply)
 */
type Status   : String(20) enum {
  DRAFT;
  SUBMITTED;
  IN_REVIEW;
  APPROVED;
  REJECTED;
}

type Category : String(20) enum {
  HARDWARE;
  SOFTWARE;
  SERVICES;
  CONSULTING;
}

type DecisionSource : String(10) enum {
  MANUAL;
  AI;
}

/** External supplier accounts. Not BTP users — they never get an XSUAA token. */
entity SupplierAccounts : cuid, managed {
  email        : String(255) not null @assert.unique;
  passwordHash : String(100) not null;
}

/**
 * Supplier login sessions. Only the SHA-256 hash of the token is stored,
 * so a leaked database does not leak usable session tokens.
 */
entity SupplierSessions {
  key tokenHash : String(64);
      account   : Association to SupplierAccounts not null;
      expiresAt : Timestamp not null;
}

/** One supplier application per account. */
entity Suppliers : cuid, managed {
  account              : Association to SupplierAccounts not null;
  email                : String(255) not null;
  companyName          : String(100) not null;
  contactPerson        : String(100) not null;
  phone                : String(30);
  country              : String(60);
  category             : Category;
  taxNumber            : String(20);
  website              : String(255);
  address              : String(500);
  notes                : String(1000);

  status               : Status default 'DRAFT';
  submittedAt          : Timestamp;
  submissionCount      : Integer default 0;

  // decision / audit trail
  decidedAt            : Timestamp;
  decidedBy            : String(255);
  decisionSource       : DecisionSource;
  rejectionComment     : String(1000);
  /** comma separated field names the supplier may change when re-applying */
  revisionFields       : String(500);

  // certificate (media data, streamed - never part of the JSON payload)
  certificate          : LargeBinary @Core.MediaType: certificateMediaType;
  certificateMediaType : String(100) @Core.IsMediaType;
  certificateFileName  : String(255);
  certificateSize      : Integer;
  certificateUploadedAt : Timestamp;
}
