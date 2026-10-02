using {supplier.mgmt as db} from '../db/schema';

/**
 * One OData V4 service for both apps.
 * - Supplier side (register / login / application / certificate upload) is public ('any').
 *   Suppliers are identified by their own session token (header X-Supplier-Token), not by XSUAA.
 * - Approver side (list, decide, AI) requires the XSUAA role 'Approval'.
 */
service SupplierService {

  // ---------- types ----------

  type AuthResult {
    token : String;
    email : String;
  }

  type ApplicationInfo {
    ID                  : UUID;
    email               : String;
    companyName         : String;
    contactPerson       : String;
    phone               : String;
    country             : String;
    category            : String;
    taxNumber           : String;
    website             : String;
    address             : String;
    notes               : String;
    status              : String;
    submittedAt         : Timestamp;
    decidedAt           : Timestamp;
    rejectionComment    : String;
    revisionFields      : String;
    certificateFileName : String;
    certificateSize     : Integer;
  }

  type AIResult {
    decision : String;
    reason   : String;
    status   : String;
  }

  type StatusCounts {
    total    : Integer;
    pending  : Integer;
    approved : Integer;
    rejected : Integer;
  }

  // ---------- supplier side (public) ----------

  @requires: 'any'
  action   register(email : String, password : String)                     returns AuthResult;

  @requires: 'any'
  action   login(email : String, password : String)                        returns AuthResult;

  @requires: 'any'
  action   logout();

  @requires: 'any'
  function getMyApplication()                                               returns ApplicationInfo;

  @requires: 'any'
  action   saveApplication(companyName : String,
                           contactPerson : String,
                           phone : String,
                           country : String,
                           category : String,
                           taxNumber : String,
                           website : String,
                           address : String,
                           notes : String)                                  returns ApplicationInfo;

  @requires: 'any'
  action   submitApplication()                                              returns ApplicationInfo;

  /**
   * Upload target for the certificate: PUT /CertificateUploads(<ID>)/certificate
   * Only UPDATE is granted; ownership + status are checked in the handler.
   */
  @restrict: [{
    grant: 'UPDATE',
    to   : 'any'
  }]
  entity CertificateUploads as
    projection on db.Suppliers {
      ID,
      @Core.AcceptableMediaTypes: ['application/pdf']
      certificate,
      certificateMediaType,
      certificateFileName
    };

  // ---------- approver side (role 'Approval') ----------

  @readonly
  @restrict: [{
    grant: [
      'READ',
      'startReview',
      'approveApplication',
      'rejectApplication',
      'analyzeWithAI'
    ],
    to   : 'Approval'
  }]
  entity Suppliers          as
    projection on db.Suppliers {
      *
    }
    excluding {
      account
    }
    where
      status != 'DRAFT'
    actions {
      action startReview();
      action approveApplication();
      action rejectApplication(comment : String, revisionFields : String);
      action analyzeWithAI() returns AIResult;
    };

  @requires: 'Approval'
  function getStatusCounts()                                                returns StatusCounts;
}
