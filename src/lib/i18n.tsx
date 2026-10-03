import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type Language = 'en' | 'km';

// Degree type is picked from a fixed dropdown at issuance (see
// IssueCredential.tsx), so unlike free-text fields it can always be mapped
// to Khmer automatically — the issuer never has to type a Khmer version.
// Kept outside the `t()`/translations table since both languages should
// show together on the credential, not switch with the active language.
const DEGREE_TITLE_KM: Record<string, string> = {
  Bachelor: 'បរិញ្ញាបត្រ',
  Master: 'អនុបណ្ឌិត',
  'Doctorate (PhD)': 'បណ្ឌិត',
  Associate: 'សញ្ញាបត្រកម្រិតអនុវិទ្យាល័យ',
};

/** "Bachelor" -> "បរិញ្ញាបត្រ (Bachelor)"; unrecognized values pass through unchanged. */
export function formatDegreeTitle(value?: string | null): string {
  if (!value) return '';
  const km = DEGREE_TITLE_KM[value];
  return km ? `${km} (${value})` : value;
}

const translations = {
  en: {
    nav: {
      wallet: 'My wallet',
      activity: 'Activity',
      account: 'Account',
      dashboard: 'Dashboard',
      issued: 'Issued',
      settings: 'Settings',
      requests: 'Requests'
    },
    layout: {
      loading: 'Loading Actik...',
      tagline: 'Proof of ownership',
      institution_dashboard: 'Institution Dashboard',
      sign_out: 'Sign out',
      install_app: 'Install app'
    },
    wallet: {
      title: 'My credential wallet',
      subtitle: 'Your digital credentials, encrypted and controlled by you',
      subtitle_count: 'My credentials · {count} held',
      vault_not_setup: 'Vault not set up (Setup)',
      vault_locked: 'Vault locked',
      vault_unlocked: 'Vault unlocked',
      lock_now: 'Lock',
      unlock_btn: 'Unlock',
      loading: 'Loading credentials...',
      encrypted_title: 'My Encrypted Credentials',
      encrypted_desc: 'Click Share on any credential to generate a unique share link.',
      empty_title: 'No credentials yet',
      empty_desc: 'Your institution will issue credentials to you. You can check notifications to view and claim pending certificates.',
      view_notifications: 'View pending notifications',
      view_all_notifications: 'View all notifications',
      category_academic_degree: 'Academic Degrees',
      category_employment_record: 'Employment',
      category_other: 'Other',
      see_all: 'See all ({count})',
      all_count: 'All {count}',
      verified: '✓ Verified',
      verified_label: 'Verified',
      encrypted_certificate_fallback: 'Encrypted certificate',
      institution_unknown: 'Institution',
      issued_by: 'Issued by: ',
      year: 'Year: ',
      issued_on: 'Issued on: ',
      issued_on_label: 'Issued',
      year_label: 'Year',
      share_label: 'Shared',
      seal_label: 'SEAL',
      unlock_vault_title: 'Unlock Your Vault',
      unlock_vault_desc: 'Your encryption keys are derived locally. Please unlock your vault to process this credential.',
      enter_pin: 'Enter Vault PIN',
      unlock_with_pin: 'Unlock with PIN',
      cancel: 'Cancel',
      authenticating: 'Authenticating...',
      biometric_prompt: 'Complete the biometric prompt on your device',
      biometric_failed: 'Biometric prompt did not appear.',
      try_again: 'Try again',
      unlock_with_passkey: 'Unlock with Passkey',
      setup_required_title: 'Encryption Vault Required',
      setup_required_desc: 'To claim credentials, you must first create an encrypted browser vault. This derives keys locally to secure your data so that Supabase only stores ciphertext.',
      setup_vault_btn: 'Set up vault',
      back_to_wallet: 'Back to Wallet',
      no_credentials_found: 'No credentials found',
      unlocking: 'Unlocking...',
      loading_single: 'Loading credential...',
      credential_not_found: 'Credential not found',
      return_to_wallet: 'Return to Wallet',
      share_credential: 'Share Credential',
      metadata_view: 'Certificate Metadata View',
      encrypted_detail_msg: 'This credential is encrypted. Unlock your vault to view the verified claims.',
      unlock_vault_to_view: 'Unlock vault to view details',
      decrypting_claims: 'Decrypting claims from vault...',
      pdf_not_supported: 'Your browser does not support viewing PDFs directly.',
      download_pdf: 'Download PDF Document',
      failed_document_preview: 'Failed to load document preview.',
      download_file: 'Download File',
      view_full_screen: 'View Full Screen',
      no_document: 'No Document',
      student_info: 'Student Information',
      student_name: 'Name:',
      student_email: 'Email:',
      student_id: 'Student ID:',
      credential_info: 'Credential Information',
      degree_type: 'Degree Type:',
      major: 'Major:',
      graduation_date: 'Graduation Date:',
      certificate_id: 'Certificate ID:',
      detail_issued_by: 'Issued by:',
      issuer_did: 'Issuer DID:',
      encrypted_badge: 'Encrypted in your vault',
      no_printed_copy: 'The institution did not sign a printed copy of this credential.',
      decline_btn: 'Decline',
      decline_confirm: 'Decline this? It will not be added to your wallet, and the offer is deleted. If it is something you want, ask the issuer to send it again.',
      raw_token_trigger: 'Advanced: export full credential',
      raw_token_modal_title: 'Full credential export',
      raw_token_modal_subtitle: 'For developer or audit use',
      raw_token_modal_warning: 'This includes every field with no selective disclosure. To control what you share, use Share instead.',
      trust_accredited_institution: 'Accredited institution',
      trust_encrypted_vault: 'Encrypted in vault',
      share_count_label: 'Shared {count}×',
      not_specified: 'Not specified',
      issue_date_label: 'Issue date',
      no_decrypted_claims: 'No decrypted claims found.',
      cancel_and_go_back: 'Cancel & Go Back',
      decryption_failed: 'Decryption failed',
      share_heading: 'Share credential',
      share_subheading: 'Choose what to reveal and how long the link stays active',
      step_configure: 'Configure',
      step_generate: 'Generate',
      choose_what_to_share: 'Choose what to share',
      choose_what_to_share_desc: 'The employer will only see the fields you select. Hidden fields are mathematically absent from the share link.',
      always_shown: 'Always shown',
      institution_name: 'Institution name',
      degree_title: 'Degree title',
      issue_date: 'Issue date',
      sensitive: 'Sensitive',
      private: 'Private',
      sharing_fields: 'Sharing {disclosed} of {total} fields',
      hidden_fields: 'Hidden: {fields}',
      will_be_hidden: 'will be hidden',
      who_is_this_for: 'Who is this for? (optional)',
      recipient_placeholder: 'e.g. Acme Corp · HR',
      single_use: 'Allow only one view',
      single_use_desc: 'The link stops working after it is first opened. Use this when the link should not be forwarded.',
      how_long_active: 'How long should this link work?',
      duration_desc: 'Choose a quick duration or set a custom expiry window.',
      day_1: '1 Day',
      days_7: '7 Days',
      days_30: '30 Days',
      days_90: '90 Days',
      custom: 'Custom',
      choose_expiration_date: 'Choose expiration date',
      link_expires_on: 'Link expires on:',
      expiry_warning: 'After expiry, this link stops working. The employer cannot re-open it. You can always create a new share link.',
      create_share_link: 'Create share link',
      share_link_created: 'Share link created',
      copy_link: 'Copy link',
      copy: 'Copy',
      copied: 'Copied!',
      copy_failed: 'Failed to copy.',
      open: 'Open',
      download_qr_png: 'Download QR PNG',
      email_employer: 'Email employer',
      disclosed_fields: 'Disclosed fields:',
      expires: 'Expires:',
      token: 'Token:',
      share_warning: 'Anyone with this link can verify your credential until it expires. Do not share it publicly.',
      no_active_share_link: 'No active share link has been created during this session.',
      go_to_configure_step: 'Go to Configure step',
      view_past_share_links: 'View all your past share links in ',
      activity: 'Activity',
      unlock_vault_to_continue: 'Unlock your vault to continue',
      unlock_vault_desc_passkey: 'Tap "Unlock vault" — your device will ask for biometric confirmation.',
      unlock_vault_desc_pin: 'Enter your vault PIN to select which fields to share.',
      unlock_vault_btn: 'Unlock vault',
      unlock_vault_modal_desc: 'Your encryption keys are derived locally. Please unlock your vault to process this credential.',
      enter_vault_pin: 'Enter Vault PIN',
      share_revoked_success: 'Share link revoked successfully',
      share_revoke_failed: 'Failed to revoke share link',
      cannot_extend_inactive: 'Cannot extend: Share link is no longer active',
      share_extend_success: 'Share link extended successfully',
      share_extend_failed: 'Failed to extend share link',
      share_activity_title: 'Share activity',
      share_activity_desc: "Every link you've created. Each is a separate, scoped disclosure — revoke any anytime.",
      loading_activity: 'Loading your activity...',
      failed_load_activity: 'Failed to load activity',
      no_share_links_yet: 'No share links yet',
      no_share_links_desc: 'When you share a credential from your wallet, the generated link will appear here so you can keep track of who has access.',
      status_active: 'Active',
      status_expired: 'Expired',
      status_revoked: 'Revoked',
      share_link_default_title: 'Share link',
      no_extra_fields: 'No extra fields',
      expires_on: 'Expires ',
      expired_on: 'Expired ',
      revoked_on: 'Revoked ',
      extend_btn: 'Extend',
      revoke_btn: 'Revoke',
      revoke_confirm_msg: 'Are you sure you want to revoke this link?',
      extend_link_expiry: 'Extend link expiry',
      plus_1_day: '+1 Day',
      plus_7_days: '+7 Days',
      plus_30_days: '+30 Days',
      plus_90_days: '+90 Days',
      new_expiry: 'New expiry: ',
      confirm_btn: 'Confirm',
      field_name: 'Full name',
      field_year: 'Graduation year',
      field_gpa: 'GPA',
      field_national_id: 'National ID',
      field_notes: 'Additional notes',
      field_email: 'Email address',
      field_student_id: 'Student ID',
      field_graduation_date: 'Graduation date',
      field_certificate_id: 'Certificate ID',
      field_photo: 'Student photo',
      field_degree: 'Degree title',
      field_institution: 'Institution',
      field_issue_date: 'Issue date',
      vault_unlock_failed: 'Vault unlock failed. Please check your PIN.',
      vault_unlock_error: 'Unlock encountered an error. Please try again.',
      passkey_auth_failed: 'Passkey authentication failed.',
      passkey_error: 'Passkey encounter error.',
      cred_save_failed: 'Credential encrypted but failed to save. Please try again.',
      cred_claim_success: 'Credential claimed and encrypted successfully!',
      notifications_title: 'Notifications',
      notifications_desc: 'Claim credentials issued to your Cambodian digital identity',
      checking_pending_credentials: 'Checking pending credentials...',
      failed_load_notifications: 'Failed to load notifications',
      refresh_to_try_again: 'Please refresh the page to try again.',
      retry_btn: 'Retry',
      all_caught_up: 'All caught up!',
      no_pending_credentials_desc: 'You have no pending credentials to claim at this time. Institutions will issue digital certificates directly to your identity.',
      claim_to_vault_btn: 'Claim to Vault',
      claim_failed_msg: 'Claim failed: ',
      claim_refused_msg: 'Not added to your wallet: ',
      unlock_and_claim_btn: 'Unlock & Claim',
      auth_biometric_desc: 'Authenticate using your secure local biometrics.',
      auth_passkey_desc: 'Authenticate using your secure device passkey.',
      unlock_with_biometric: 'Unlock with Biometric',
      vault_setup_required_title: 'Vault setup required',
      vault_setup_required_desc: 'Your digital credentials are encrypted locally for zero-knowledge privacy. You must set up your vault to store this certificate.',
      setup_my_vault_btn: 'Set up my vault',
      vault_setup_subtitle: 'Your credentials are encrypted with a key that only your device holds',
      step_choose_method: 'Choose method',
      step_create_vault: 'Create vault',
      step_done: 'Done',
      how_to_unlock: 'How do you want to unlock your vault?',
      recommended_badge: 'Recommended',
      biometric_title: 'Biometric',
      biometric_desc: 'Use Face ID, Touch ID, or Windows Hello. Instant, secure, and stays on this device.',
      bio_feature_1: 'Immediate biometric prompt',
      bio_feature_2: 'No external key needed',
      bio_feature_3: 'Highly secure & local',
      pin_title: '6-digit PIN',
      pin_desc: 'Set a 6-digit numeric passcode to unlock your credentials on any browser.',
      pin_feature_1: 'Works on any device',
      pin_feature_2: 'Easy to configure',
      pin_feature_3: 'No hardware needed',
      create_pin: 'Create your 6-digit PIN',
      confirm_pin: 'Confirm your PIN',
      pin_mismatch: 'PINs must match.',
      bio_setup_notice: 'Biometric setup is handled locally. Your device will prompt you when you proceed.',
      go_back: 'Go Back',
      continue_btn: 'Continue',
      creating_keys: 'Creating Vault Keys...',
      creating_keys_desc: 'Please wait while we initialize your local vault. Do not close this window.',
      passkey_failed_title: 'Passkey creation failed.',
      passkey_failed_desc: 'Could not configure local passkey. Please try again.',
      vault_ready_title: 'Your Vault is Ready!',
      vault_ready_desc: 'Your digital credentials can now be safely claimed and decrypted locally.',
      return_wallet_btn: 'Return to Wallet',
      sec_recs: 'Security Recommendations:',
      sec_recs_desc: 'Use a hardware passkey for biometrics-backed protection. Remember that Actik handles zero-knowledge encryption: if you lose your PIN or passcode, recovery is impossible. Never share your security secrets.',
      show_pin_digits: 'Show PIN digits',
      pin_mismatch_error: '❌ Passcodes do not match',
      pin_matches: '✓ PIN matches',
      how_it_works: 'How does this work?',
      creating_your_vault: 'Creating your vault',
      confirm_with_device: 'Your browser will ask you to confirm with your',
      generating_key: 'Generating encryption key...',
      creating_envelope: 'Creating vault envelope...',
      saving_actik: 'Saving to Actik...',
      verifying_vault: 'Verifying vault...',
      vault_creation_failed: 'Vault creation failed:',
      vault_protected_by: 'Your credentials are now protected by your',
      pin_passcode: 'PIN passcode',
      biometrics_touch: 'biometrics (Touch ID / Face ID)',
      only_you_open: 'Only you can open this vault',
      only_you_open_desc: '— not even Actik can read your credentials or access your private keys.',
      if_lose_access: 'If you lose access',
      if_lose_access_desc: 'to your recovery codes, ask your university or ministry to re-issue your certificate.',
      backup_methods: 'Backup methods:',
      backup_methods_desc: 'You can add a backup unlock passcode or manage envelopes in Settings later.',
      return_wallet_claim: 'Return to wallet to claim your credentials',
      go_dashboard: 'Go to dashboard',
      delete_vault_warning: 'This will delete your vault',
      reset_vault_desc: 'Resetting your vault will permanently delete all encrypted credentials stored in it. You will need to re-claim all credentials from your institutions. This action cannot be undone.',
      type_reset_confirm: 'Type RESET to confirm',
      reset_btn: 'Reset',
      change_unlock_method_q: 'Change Unlock Method?',
      change_unlock_desc: 'Changing your unlock method requires generating new local keys. Any credentials currently stored in your wallet will need to be re-encrypted or reclaimed.',
      proceed_reconfigure: 'Proceed to Reconfigure'
    },
    dashboard: {
      loading_dashboard: 'Loading dashboard details...',
      register_institution: 'Register Institution',
      register_desc: 'Join the Cambodia trust registry. Once registered and approved by MoEYS, you can issue secure digital certificates.',
      institution_name: 'Institution name',
      domain_name: 'Domain name',
      domain_desc: 'This domain builds your did:web identity (e.g. did:web:rupp.edu.kh) to verify your credentials.',
      institution_type: 'Institution type',
      select_type: 'Select type...',
      university: 'University',
      ministry: 'Ministry',
      training_centre: 'Training Centre',
      other: 'Other',
      register_btn: 'Register institution',
      issuer_dashboard: 'Issuer Dashboard',
      manage_desc: 'Manage your certificates and view institution settings.',
      awaiting_approval: 'Awaiting MoEYS Approval',
      awaiting_desc: 'Your institution registration request has been submitted to the registry. The Ministry of Education, Youth and Sport (MoEYS) will inspect and accredit your profile shortly.',
      awaiting_note: 'Note: You will be allowed to issue digital credentials once your profile is marked accredited in the system.',
      key_expired: 'Cryptographic Signing Key Expired',
      key_expired_desc1: 'For compliance and wallet security, your private signing key is stored in this local browser session. Closing the tab, refreshing, or timing out clears the memory.',
      key_expired_desc2: 'To begin issuing certificates, please re-generate your signing key and update the public registry.',
      regenerate_keys: 'Re-generate & Update Keys',
      issue_credential: 'Issue a Credential',
      issue_credential_desc: 'Select a certificate type and issue a secure, verifiable digital credential to a student.',
      start_issuance: 'Start Issuance',
      issued_creds: 'Issued Credentials',
      issued_creds_desc: 'Credentials you have issued to students.',
      no_creds_issued: 'No credentials issued yet',
      no_creds_issued_desc: 'When you issue credentials, they will appear here.',
      academic_degrees: 'ACADEMIC DEGREES',
      other_credentials: 'OTHER CREDENTIALS',
      see_all: 'See all',
      status_claimed: 'Claimed',
      status_issued: 'Issued',
      status_withdrawn: 'Withdrawn',
      manage_withdrawals: 'Withdraw a credential, or renew your withdrawal list',
      status_pending: 'Pending',
      stat_total_issued: 'Total issued',
      stat_claimed: 'Claimed',
      stat_pending: 'Awaiting claim',
      stat_verifications: 'Verifications',
      stat_verifications_sub: 'by employers',
      accredited_pill: 'Accredited',
      pending_approval_pill: 'Pending Approval',
      recent_issuances: 'Recent issuances',
      table_holder: 'Holder',
      table_credential: 'Credential',
      table_issued: 'Issued',
      table_status: 'Status',
      issuance_volume: 'Issuance, 6 months',
      signing_key_active: 'Signing key active',
      save_as_draft_btn: 'Save as draft',
      draft_found_title: 'You have an unsaved draft',
      draft_found_desc: 'Saved',
      resume_draft_btn: 'Resume draft',
      discard_draft_btn: 'Discard',
      draft_saved_toast: 'Draft saved — resume it anytime from Issue a credential.',
      draft_card_title: 'Draft credential in progress',
      continue_editing_btn: 'Continue editing',
      back_to_issued: 'Back to Issued',
      no_creds_in_category: 'No credentials found in this category.',
      checking_auth: 'Checking authorization...',
      inst_not_registered: 'Institution Not Registered',
      inst_not_registered_desc: 'You need to register your institution profile before you can access the credential issuance panel.',
      awaiting_desc_issue: 'Your institution profile is registered, but it has not been accredited by MoEYS (Ministry of Education, Youth and Sport) yet.',
      awaiting_note_issue: 'You cannot issue digital credentials until accreditation approval is granted.',
      back_to_dashboard: 'Back to dashboard',
      session_expired: 'Signing Session Expired',
      session_expired_desc1: 'Your cryptographic signing key is no longer available in this browser session. This happens when you close the tab, refresh the page, or the session timeout is reached.',
      session_expired_desc2: 'Note: Your institution registration remains fully safe in the registry. You only need to sign back in with your Google account to reload the session key.',
      sign_out_back_in: 'Sign out and back in',
      credential_issued: 'Credential Issued',
      review_title: 'Review before issuing',
      review_desc: 'Double-check the details below. Once issued, this credential is cryptographically signed and cannot be edited.',
      confirm_issue_btn: 'Confirm & Issue',
      back_to_edit: 'Back to edit',
      student_email: 'Student Email',
      degree_cert_label: 'Degree Certificate',
      institution: 'Institution',
      issue_success_active: 'The student has an active account. They will instantly see this credential in their wallet and can claim it.',
      issue_success_pending: 'The credential is saved in the pending registry. The student can claim it as soon as they sign up for an Actik account using this email address.',
      issue_another: 'Issue another credential',
      issue_credential_title: 'Issue a credential',
      step_type: 'Type',
      live_preview: 'Live preview',
      degree_preview_placeholder: 'Select a degree type…',
      credential_preview_placeholder: 'Credential title',
      issue_credential_desc_form: 'Sign and send a digital certificate to a student.',
      signing_as: 'Signing as:',
      type_academic: 'Academic Degree',
      type_academic_desc: 'Degrees, diplomas, and formal academic programs',
      type_attendance: 'Attendance & Participation',
      type_attendance_desc: 'Conferences, workshops, and seminars',
      type_completion: 'Completion & Internship',
      type_completion_desc: 'Short courses, bootcamps, and internships',
      type_merit: 'Merit & Excellence',
      type_merit_desc: 'Awards, honors, and special achievements',
      type_appreciation: 'Appreciation & Service',
      type_appreciation_desc: 'Volunteer work and community service',
      type_professional: 'Professional Certification',
      type_professional_desc: 'Licenses, permits, and professional credentials',
      change_cert_type: 'Change certificate type',
      student_section: 'Student Section',
      student_email_req: 'Student email',
      student_found: '✓ Student account found',
      student_not_found_warning: '⚠ No Actik account found with this email. The credential will be issued but the student cannot claim it until they sign up.',
      student_check_error: '⚠ Could not check this email right now. Please try again — this is different from "no account found".',
      full_name_req: 'Full name',
      credential_details: 'Credential Details',
      issuing_institution: 'Issuing institution',
      degree_type_req: 'Degree Type',
      major_req: 'Major',
      student_id_req: 'Student ID',
      grad_date_req: 'Graduation Date',
      cert_id_req: 'Certificate ID',
      cert_doc_req: 'Certificate document',
      cert_doc_desc: 'Upload a PDF or image of the certificate.',
      type_req: 'Type',
      event_name_req: 'Event name',
      event_date_req: 'Event date',
      organizer_req: 'Organizer',
      role_desc_opt: 'Role / Description (Optional)',
      program_name_req: 'Program name',
      duration_opt: 'Duration (Optional)',
      completion_date_req: 'Completion date',
      dept_role_opt: 'Department / Role (Optional)',
      achievement_title_req: 'Achievement title',
      basis_desc_req: 'Basis / Description',
      date_awarded_req: 'Date awarded',
      reason_req: 'Reason for appreciation',
      capacity_opt: 'Capacity / Role (Optional)',
      date_req: 'Date',
      cert_name_req: 'Certification name',
      issuing_body_req: 'Issuing body',
      license_num_opt: 'License number (Optional)',
      date_certified_req: 'Date certified',
      expiry_date_opt: 'Expiry date (Optional)',
      select_file: 'Select a file',
      change_file: 'Change file',
      upload_another: 'Upload another',
      pdf_image_limit: 'PDF or Image (Max 5MB)',
      issue_credential_btn: 'Issue Credential',
      issuing_status: 'Issuing...',
      additional_notes_opt: 'Additional notes (optional)',
      remove_document: 'Remove document',
      checking_registration: 'Checking registration status...',
      inst_already_registered: 'Institution Already Registered',
      inst_linked_desc: 'Your account is linked to the following institution profile:',
      inst_name: 'Name',
      inst_domain: 'Domain',
      inst_did: 'Decentralised ID (DID)',
      accredited_badge: 'Accredited by MoEYS',
      pending_badge: 'Pending MoEYS approval',
      cannot_issue_until_approved: 'You cannot issue credentials until MoEYS approves your institution.',
      inst_registered: 'Institution Registered',
      next_steps: 'Next Steps:',
      step_added_registry: 'Your institution has been added to the Actik registry.',
      step_moeys_review: 'MoEYS will review and approve your institution.',
      step_can_issue: 'You will be able to issue credentials once approved.',
      step_key_stored: 'Your private signing key is stored in this browser session only.',
      register_inst_title: 'Register your institution',
      register_inst_desc: 'Once approved by MoEYS, your institution can issue digital credentials.',
      inst_name_label: 'Institution name',
      domain_label: 'Domain',
      domain_help: "Use your institution's official web domain. This becomes part of your digital identity",
      what_is_did: 'What is a DID?',
      did_desc1: 'A DID (Decentralised Identifier) is a unique digital identity for your institution.',
      did_example: 'Example: ',
      did_desc2: 'It is tied to your domain and used to digitally sign every credential you issue.',
      did_desc3: 'Employers can verify credentials were signed by your institution without contacting you.',
      inst_type_label: 'Institution type',
      type_employer: 'Employer (company or organisation)',
      employee_section: 'Employee',
      employee_email: 'Employee email',
      employee_email_req: 'Employee email',
      employee_found: '✓ Employee has an Actik account',
      issuing_employer: 'Employer',
      issue_desc_employment: 'Sign and send an employment record. It reaches the employee’s wallet only if they accept it.',
      type_employment: 'Employment record',
      type_employment_desc: 'Confirms someone works or worked here: job title and dates. The employee accepts it into their wallet.',
      job_title_req: 'Job title *',
      employment_type_req: 'Employment type *',
      employment_type_full_time: 'Full-time',
      employment_type_part_time: 'Part-time',
      employment_type_contract: 'Contract',
      employment_type_internship: 'Internship',
      employment_type_volunteer: 'Volunteer',
      employment_start_req: 'Start date *',
      employment_end: 'End date',
      still_employed: 'Still employed here',
      department_opt: 'Department (optional)',
      job_description_opt: 'Role, in a line (optional)',
      employment_never: 'An employment record never carries salary, reason for leaving, performance or disciplinary notes. When the job ends or the title changes, issue a new record and withdraw this one as “replaced by a corrected credential”.',
      employer_note: 'A registered employer issues employment records to its staff — job title and dates — and nothing else. Verifiers show it as a registered employer, not an accredited institution.',
      register_btn_text: 'Register Institution'
    },
    role: {
      issuer: 'Issuer',
      student: 'Student',
      admin: 'Admin'
    },
    settings: {
      title: 'Institution Settings',
      subtitle: 'Manage your institution profile',
      language: 'Language Preference',
      language_desc: 'Choose your preferred language for the dashboard interface.',
      status_loading: 'Loading settings...',
      status_failed: 'Failed to load profile',
      status_error: 'An error occurred while connecting to Supabase.',
      retry_btn: 'Retry',
      copied: 'Copied to clipboard!',
      copy_failed: 'Failed to copy.',
      accreditation_revoked: 'Accreditation Revoked',
      accreditation_revoked_on: 'Accreditation revoked on',
      accredited: 'Accredited',
      approved_by_moeys: 'Approved by MoEYS',
      approved_by_moeys_on: 'on',
      pending_approval: 'Pending Approval',
      awaiting_moeys_approval: 'Awaiting MoEYS approval',
      no_inst_registered: 'No Institution Registered',
      no_inst_desc: 'Your issuer profile has not been configured. To sign digital credentials on behalf of your institution, you must complete the registration first.',
      register_inst_btn: 'Register Institution',
      inst_profile: 'Institution Profile',
      official_name: 'Official Name',
      inst_domain: 'Institutional Domain',
      inst_type: 'Institution Type',
      registered_date: 'Registered Date',
      updated_date: 'Updated Date',
      did_title: 'Decentralized Identifier (DID)',
      did_label: 'Decentralized Identifier (DID)',
      did_desc_label: 'Decentralized Identifier (DID):',
      did_desc_text: 'Your unique institutional identifier on Actik. It is standard did:web format bound to your institutional domain, allowing verifiers worldwide to cryptographically resolve your public signing keys.',
      accreditation_status: 'Accreditation Status',
      accreditation_pending_desc: 'Your registration has been received successfully. Ministry of Education, Youth and Sport (MoEYS) administrators will review your credentials domain setup before approving your accreditation. You cannot issue credentials while pending approval.',
      public_key_title: 'Public Key (for verification)',
      copy_btn: 'Copy',
      copied_btn: 'Copied',
      public_key_desc_label: 'Public Key (ES256):',
      public_key_desc_text: 'This key is public and used by verifiers to validate the signatures on certificates you issue. Your matching private signing key is derived in your browser session and is never shared or stored in the database.'
    },
    account: {
      title: 'Your Vault is Ready',
      subtitle: 'Your digital credentials are encrypted locally with zero-knowledge keys. You can now claim, store, and verify your certificates.',
      account_info: 'Account Information',
      email: 'Email Address',
      role: 'Account Role',
      created: 'Account Created',
      vault_security: 'Vault Security',
      unlock_method: 'Unlock Method',
      vault_configured: 'Vault Configured',
      change_unlock: 'Change Unlock Method',
      go_wallet: 'Go to my wallet',
      reset_vault: 'Reset vault',
      language: 'Language Preference',
      language_desc: 'Choose your preferred language for the wallet interface.',
      setup_title: 'Set up your vault',
      checking_vault: 'Checking vault status...',
      pin_method: '6-digit PIN',
      bio_method: 'Biometric',
      sec_recs: 'Security recommendations',
      sec_recs_desc: "Never share your PIN with anyone, even Actik support."
    },
    landing: {
      nav_signin: 'Sign in',
      hero_eyebrow: 'Digital proof of ownership',
      hero_title: 'Own it. Prove it. Anywhere.',
      hero_subtitle: 'Actik turns real credentials into verifiable digital proof — starting with certificates from accredited institutions, encrypted in a vault only you control.',
      hero_cta: 'Sign in to get started',
      hero_cta_sub: 'Free for students. Institutions apply for accreditation.',
      trust_badge: 'Cryptographically signed · Independently verifiable',
      how_title: 'How it works',
      how_step1_title: 'An accredited institution issues',
      how_step1_desc: 'Universities and training providers approved by an admin issue signed digital credentials directly to you.',
      how_step2_title: 'You hold it, encrypted',
      how_step2_desc: 'Your credentials live in a vault only you can unlock — with a PIN or biometrics. Actik never sees your keys.',
      how_step3_title: 'Anyone can verify instantly',
      how_step3_desc: 'Share a link or QR code. Verifiers check the cryptographic signature in seconds — no phone calls, no waiting.',
      trust_title: 'Built to be trusted, not just believed',
      trust_1_title: 'Signed, not scanned',
      trust_1_desc: 'Every credential carries a cryptographic signature tied to the issuing institution — tamper-evident by design.',
      trust_2_title: 'Accreditation, verified live',
      trust_2_desc: 'Institutions are reviewed and approved before they can issue. Verification checks their status in real time.',
      trust_3_title: 'You control the keys',
      trust_3_desc: 'Your vault is encrypted on your own device. Actik stores ciphertext, not your data.',
      for_title: 'Built for Cambodia, starting with education',
      for_desc: 'Actik began with academic certificates because the need was clearest — the same proof-of-ownership foundation is built to extend to any asset worth verifying.',
      for_students_title: 'Students & graduates',
      for_students_desc: 'Collect your credentials in one place and share them instantly when applying for jobs or further study.',
      for_institutions_title: 'Institutions',
      for_institutions_desc: 'Issue verifiable certificates once accredited by an admin — no more manual authentication letters.',
      for_employers_title: 'Employers',
      for_employers_desc: 'Verify a certificate in seconds, no account needed — just open the link.',
      final_cta_title: 'Ready to get started?',
      final_cta_desc: 'Sign in with Google — takes less than a minute.',
      final_cta_button: 'Sign in',
      footer_rights: '© 2026 Actik. All rights reserved.'
    },
    proof: {
      page_title: 'Proof requests',
      page_intro: 'Ask for proof of qualifications, or answer a request from your wallet. Answers carry only what the request may see, checked against the institution that issued it.',
      your_requests: 'Requests you made',
      new_request: 'New request',
      no_requests: 'You have not made a request.',
      your_answers: 'Requests you answered',
      no_answers: 'You have not answered a request.',
      answers_count: '{count} answer(s)',
      until: 'open until {date}',
      sent_items: '{count} credential(s) sent',
      withdraw_answer: 'Withdraw',
      withdraw_confirm: 'Withdraw your answer? The requester will no longer see it.',
      status_open: 'Open',
      status_closed: 'Closed',
      status_expired: 'Expired',
      status_closed_long: 'This request is closed and no longer takes answers.',
      status_expired_long: 'This request has expired and no longer takes answers.',
      new_intro: 'Say what you need to see. Candidates answer from their own wallets, and only with credentials an institution issued.',
      requester_name: 'Who is asking',
      requester_name_hint: 'Your organisation, as candidates will see it. Actik shows it as stated by you, not verified.',
      request_title: 'What it is for',
      request_title_placeholder: 'e.g. Junior accountant, Phnom Penh office',
      description: 'Details (optional)',
      what_you_ask: 'What you ask for',
      credential_type: 'Credential type',
      remove: 'Remove',
      also_ask: 'Also ask to see:',
      note: 'Note',
      note_placeholder: 'Your note, e.g. “in accounting or finance” (optional)',
      add_requirement: 'Ask for another credential',
      always_shown: 'Every answer shows the holder’s name, the issuing institution, the credential itself, its document number and date — so you can check the person’s ID at interview.',
      never_asked: 'A request cannot ask for date of birth or age, sex, marital status, a photograph, national ID, student number, place of birth, religion or ethnicity, or an email or phone number.',
      open_for: 'Open for',
      days: '{count} days',
      saving: 'Saving…',
      create: 'Create request',
      invalid_REQUESTER_NAME: 'Say who is asking (2–120 characters).',
      invalid_TITLE: 'Give the request a title (2–120 characters).',
      invalid_DESCRIPTION: 'The details are too long.',
      invalid_NO_REQUIREMENTS: 'Ask for at least one credential.',
      invalid_TOO_MANY_REQUIREMENTS: 'Ask for at most five credentials.',
      invalid_UNKNOWN_TYPE: 'That credential type cannot be requested.',
      invalid_FIELD_NOT_REQUESTABLE: 'That field cannot be requested.',
      invalid_NOTE: 'A note is too long.',
      invalid_EXPIRY: 'A request stays open for 1 to 90 days.',
      not_found: 'There is no such request.',
      share_heading: 'Share this request',
      share_hint: 'Send the link or show the code. Anyone with it can see what you ask; only people who answer send you anything.',
      close_request: 'Close request',
      close_confirm: 'Close this request? Nobody will be able to answer it any more.',
      answers_heading: 'Answers ({count})',
      answers_hint: 'Each answer is checked on this device against the signed trust registry and the institution’s withdrawal list.',
      no_answers_yet: 'No answers yet.',
      contact: 'Contact:',
      not_answered: 'Not answered.',
      not_asked_WRONG_TYPE: 'Not counted: this is a different kind of credential from the one asked for.',
      not_asked_OVER_DISCLOSED: 'Not shown: this answer carries fields the request could not ask for.',
      not_asked_NO_SUCH_REQUIREMENT: 'Not shown.',
      could_not_check: 'Could not be checked right now',
      did_not_verify: 'Did not verify',
      issued_by: 'Issued by',
      check_id: 'Issued to {name}. Check the person’s ID at interview: a credential proves who it was issued to, not who is presenting it.',
      request_from: 'Proof request',
      requester_unverified: 'As the requester describes themselves. Actik has not verified who they are.',
      they_ask: 'They ask for',
      answer_shows: 'An answer shows your name, the issuing institution, the credential, its document number and date, and any extra field listed above — nothing else.',
      answer_from_wallet: 'Answer from my Actik wallet',
      answer_privacy: 'Only the requester sees your answer. You can withdraw it at any time from Proof requests.',
      no_wallet: 'You need an Actik wallet with credentials to answer.',
      set_up_wallet: 'Set up your wallet',
      unlock_failed: 'The wallet did not unlock. Try again.',
      no_match: 'Your wallet has no credential of this kind.',
      checking: 'Checking…',
      skip_requirement: 'Do not answer this one',
      they_will_see: '{requester} will see:',
      contact_label: 'How they can reach you',
      contact_hint: 'Shown to the requester with your answer. Your account email is not shared unless you leave it here.',
      sending: 'Sending…',
      send_answer: 'Send {count} credential(s)',
      already_answered: 'You have already answered this request. Withdraw that answer first to send a new one.',
      sent_title: 'Answer sent.',
      sent_desc: '{requester} can now see what you sent. You can withdraw it from Proof requests.',
      type_academic_degree: 'Academic degree',
      type_professional_certification: 'Professional certification',
      type_completion: 'Certificate of completion',
      type_attendance_participation: 'Attendance or participation',
      type_merit_excellence: 'Merit or excellence award',
      type_appreciation_service: 'Appreciation or service',
      field_institution: 'Institution',
      field_name: 'Name',
      field_degree_type: 'Degree',
      field_degree: 'Degree',
      field_graduation_date: 'Graduation date',
      field_certificate_id: 'Certificate number',
      field_sub_type: 'Type',
      field_event_name: 'Event',
      field_event_date: 'Event date',
      field_organizer: 'Organiser',
      field_program_name: 'Programme',
      field_completion_date: 'Completion date',
      field_achievement_title: 'Achievement',
      field_date_awarded: 'Date awarded',
      field_reason: 'Reason',
      field_date: 'Date',
      field_cert_name: 'Certification',
      field_issuing_body: 'Issuing body',
      field_date_certified: 'Date certified',
      field_license_number: 'Licence number',
      field_expiry_date: 'Expiry date',
      field_major: 'Major',
      field_gpa: 'GPA',
      field_duration: 'Duration',
      field_department_or_role: 'Department or role',
      field_role_description: 'Role',
      field_basis_description: 'Basis of award',
      field_capacity: 'Capacity',
      type_employment_record: 'Employment record',
      kind_institution: 'Accredited institution',
      kind_employer: 'Registered employer',
      field_job_title: 'Job title',
      field_employment_type: 'Employment type',
      field_employment_start: 'Started',
      field_employment_end: 'Ended',
      field_employment_status: 'Status',
      field_department: 'Department',
      employment_current_as_of: 'Current, as of {date} (when the employer signed it)',
      employment_ended: 'Ended',
      employment_type_full_time: 'Full-time',
      employment_type_part_time: 'Part-time',
      employment_type_contract: 'Contract',
      employment_type_internship: 'Internship',
      employment_type_volunteer: 'Volunteer',
    },
    museum: {
      title: 'Add to a CamboVerse museum',
      intro: 'You decide what can be shown. The original file stays in your wallet — the exhibit carries only its fingerprint, the picture you prepare here and, if you choose, the institution’s signed code.',
      image_heading: 'What the picture shows',
      mode_cover: 'Cover',
      mode_crop: 'Crop',
      cover_hint: 'Drag over anything you do not want shown — date or place of birth, ID or student number, photograph, signatures.',
      crop_hint: 'Drag to choose the part of the certificate to show.',
      undo: 'Undo',
      reset: 'Start again',
      no_image: 'Show no picture — only the title and the institution',
      pdf_no_image: 'This certificate is a PDF, so no picture goes with the exhibit; it shows the title and the institution.',
      no_file: 'This credential has no file, so the exhibit shows the title and the institution.',
      sensitive_heading: 'This credential carries:',
      sensitive_hint: 'They are probably printed on the certificate. Cover them before showing it.',
      general_warning: 'Certificates often show a full name, date and place of birth, an ID or student number and a photograph. The picture is reduced in size and re-saved, which removes hidden photo data such as location.',
      visibility_heading: 'Who may see it',
      vis_private: 'Only me',
      vis_private_hint: 'It hangs in your room and is shown to no one else.',
      vis_link: 'People I send a link to',
      vis_link_hint: 'Shown only to people who have your room’s link.',
      vis_public: 'Anyone',
      vis_public_hint: 'Anyone who finds your room.',
      vis_note: 'This is the most the museum may show it to. If your room is set stricter, the room wins.',
      public_confirm: 'I have checked the picture and it shows nothing I do not want public.',
      printed_heading: 'The institution’s signed code',
      printed_include: 'Include it',
      printed_hint: 'Lets the museum show who issued it, checked on the viewer’s own device. Anyone who can see the exhibit can read what the code signs: your name, the document number, the institution and the date.',
      printed_none: 'This credential has no printed code, so the museum will show it as added by you.',
      preview: 'Preview the picture',
      preview_heading: 'Exactly what can be shown',
      prepare: 'Prepare exhibit file',
      preparing: 'Preparing…',
      download: 'Download exhibit file',
      copy: 'Copy',
      copied: 'Copied',
      done: 'Exhibit file ready. Add it to your room in CamboVerse. It will say you added it — that is normal, not a warning.',
      refused_withdrawn: 'The institution has withdrawn this credential, so it cannot be added to a museum.',
      refused_rejected: 'This credential did not verify, so it cannot be added to a museum.',
      close: 'Close',
      export_button: 'Add to museum',
    },
    print: {
      title: 'Printable certificate',
      toolbar_hint: 'Print on A4, landscape. Use “Save as PDF” in the print dialog to keep a file.',
      print_button: 'Print',
      reprint: 'Print certificate',
      certifies: 'This certifies that',
      has_been_awarded: 'has been awarded',
      signed_fields: 'Signed into the code — the verifier’s screen must show exactly these',
      field_holder: 'Holder',
      field_document_id: 'Document number',
      field_institution: 'Issuing institution',
      field_issue_date: 'Issue date',
      scan_caption: 'Verify with the Actik app.',
      no_website: 'This code does not open a website. If a scanner offers to open one, this is not a genuine certificate.',
      offer_title: 'Printed certificate',
      offer_desc: 'A copy whose QR code carries the signed credential itself — verified in the Actik app, with no website involved.',
      offer_button: 'Open printable certificate',
      unavailable_no_number: 'Not available for this credential: a printed certificate needs a document number (certificate or licence number) for the verifier to compare with the paper.',
      unavailable_error: 'The printable certificate could not be prepared:',
    },
    scan: {
      tagline: 'Verify a printed certificate',
      title: 'Verify a printed certificate',
      intro: 'Scan the QR code on an Actik certificate. It is checked here, in this app — a genuine certificate never sends you to a website.',
      mode_camera: 'Camera',
      mode_photo: 'Photo',
      mode_paste: 'Paste',
      start_camera: 'Start camera',
      camera_error: 'The camera could not be opened. Allow camera access, or use a photo of the code instead.',
      choose_photo: 'Choose a photo of the QR code',
      photo_hint: 'A clear, straight photo of the code on the paper.',
      no_code_found: 'No QR code could be read from that image. Try a closer, sharper photo.',
      verify_button: 'Verify',
      checking: 'Checking…',
      scan_another: 'Scan another',
      url_title: 'This code opens a website',
      other_title: 'Not an Actik certificate code',
      other_desc: 'This app could not find an Actik credential in this code. That does not make it a forgery — it is simply not something this app checks.',
      rejected_title: 'This certificate did not verify',
      do_not_accept: 'Do not accept this certificate as proof.',
      signed_by: 'A key that the signed trust registry lists for {issuer} signed the fields below. That is what was checked.',
      retired_key_note: '(It was signed with a key the institution has since retired, before it was retired.)',
      compare_desc: 'Compare each of these with the paper in front of you. A genuine code copied onto a forged certificate still verifies — this comparison is what catches it.',
      type_to_compare: 'Type what the paper says, to compare exactly',
      matches_typed: 'matches what you typed',
      differs_typed: 'differs — you typed “{value}”',
      mismatch_warning: '{count} field(s) differ from the paper. Do not accept this certificate.',
      trust_list_version: 'signed trust list v{version}',
    },
    verify: {
      tagline: 'Proof of ownership',
      result_label: 'Verification result',
      invalid_link_title: 'Invalid verification link',
      invalid_link_desc: 'This does not appear to be a valid Actik verification link',
      invalid_link_hint: 'Check that you have the full URL',
      loading_title: 'Verifying credential…',
      no_account_needed: 'no account needed · nothing is stored about you',
      check_1: 'Loading credential…',
      check_2: 'Checking link validity…',
      check_3: 'Verifying issuer signature…',
      check_4: 'Checking the signed trust registry…',
      check_5: 'Checking whether the issuer withdrew it…',
      withdrawn_title: 'Withdrawn by the issuer',
      withdrawn_withdrawn: 'The institution that issued it has withdrawn it.',
      withdrawn_corrected: 'The institution has replaced it with a corrected credential. Ask the holder for the corrected one.',
      standing_clear_title: 'Not withdrawn.',
      standing_clear_desc: "Checked against {issuer}'s withdrawal list, version {version}, dated {date}. A withdrawal made after that date would not show here.",
      standing_unchecked_title: 'Signature valid, standing unchecked.',
      standing_none_desc: '{issuer} publishes no withdrawal list, so whether it has since withdrawn this credential is not known. Do not treat it as current on the strength of this page alone.',
      standing_lapsed_desc: "{issuer}'s withdrawal list lapsed on {date}, so whether it has since withdrawn this credential is not known. Do not treat it as current on the strength of this page alone.",
      success_title: 'Signature checked',
      success_desc: 'A key listed in the trust registry signed the fields below. That is what was checked — it does not confirm that the document in your hand is the one that was issued.',
      unavailable_title: 'Verification unavailable',
      compare_heading: 'Compare with the document',
      compare_desc: 'Nothing about the paper or the file is signed. Check these four against the document in front of you.',
      compare_subject: 'Name of holder',
      compare_document_id: 'Document number',
      compare_organisation: 'Issuing institution',
      compare_issue_date: 'Issue date',
      compare_not_disclosed: 'not disclosed',
      issued_by_label: 'Issued by:',
      accredited_badge: 'Listed as accredited in the trust registry',
      credential_details_heading: 'Credential details',
      hidden_fields_notice: 'Some fields are hidden by the holder (selective disclosure).',
      hidden_label: 'Hidden:',
      hidden_count_label: '{count} hidden by the credential holder',
      link_valid_until: 'Link valid until:',
      link_expiring_soon: 'This link expires soon',
      technical_details_toggle: 'Technical verification details',
      issuer_did_label: 'Issuer DID:',
      share_token_label: 'Share token:',
      verified_at_label: 'Verified at:',
      format_label: 'Format:',
      algorithm_label: 'Algorithm:',
      failed_title: 'Verification failed',
      verification_steps_heading: 'Verification steps',
      what_to_do_label: 'What to do:',
      reason_label: 'Reason:',
      footer_heading: 'How does Actik verification work?',
      trust_signature_title: 'Cryptographic signature',
      trust_signature_desc: 'Shows which registered key signed these fields',
      trust_registry_title: 'Trust registry',
      trust_registry_desc: 'The registry records which institutions are accredited',
      trust_disclosure_title: 'Selective disclosure',
      trust_disclosure_desc: 'Holder controls what you see',
      powered_by: 'Powered by Actik — Proof of ownership',
      learn_more: 'Learn more at actik.app',
      close: 'Close',
      pdf_not_supported: 'PDF preview not supported in this browser.',
    }
  },
  km: {
    nav: {
      wallet: 'កាបូបរបស់ខ្ញុំ',
      activity: 'សកម្មភាព',
      account: 'គណនី',
      dashboard: 'ផ្ទាំងគ្រប់គ្រង',
      issued: 'បានចេញ',
      settings: 'ការកំណត់',
      requests: 'សំណើ' // TODO(km-review)
    },
    layout: {
      loading: 'កំពុងផ្ទុក Actik...',
      tagline: 'ភស្តុតាងកម្មសិទ្ធិ',
      institution_dashboard: 'ផ្ទាំងគ្រប់គ្រងស្ថាប័ន',
      sign_out: 'ចាកចេញ',
      install_app: 'ដំឡើងកម្មវិធី' // TODO(km-review)
    },
    wallet: {
      title: 'កាបូបលិខិតរបស់ខ្ញុំ',
      subtitle: 'វិញ្ញាបនបត្រឌីជីថលរបស់អ្នក ដែលត្រូវបានអ៊ិនគ្រីប និងគ្រប់គ្រងដោយអ្នកផ្ទាល់',
      subtitle_count: 'លិខិតរបស់ខ្ញុំ · កាន់កាប់ {count}', // TODO(km-review)
      vault_not_setup: 'មិនទាន់បានរៀបចំកាបូប (រៀបចំ)',
      vault_locked: 'កាបូបបានចាក់សោ',
      vault_unlocked: 'កាបូបបានបើកសោ',
      lock_now: 'ចាក់សោ', // TODO(km-review)
      unlock_btn: 'បើកសោ', // TODO(km-review)
      loading: 'កំពុងផ្ទុកវិញ្ញាបនបត្រ...',
      encrypted_title: 'វិញ្ញាបនបត្រដែលបានអ៊ិនគ្រីបរបស់ខ្ញុំ',
      encrypted_desc: 'ចុច ចែករំលែក នៅលើវិញ្ញាបនបត្រណាមួយដើម្បីបង្កើតតំណចែករំលែកតែមួយគត់។',
      empty_title: 'មិនទាន់មានវិញ្ញាបនបត្រទេ',
      empty_desc: 'ស្ថាប័នរបស់អ្នកនឹងចេញវិញ្ញាបនបត្រឱ្យអ្នក។ អ្នកអាចពិនិត្យមើលការជូនដំណឹងដើម្បីមើល និងទទួលយកវិញ្ញាបនបត្រដែលរង់ចាំការទទួល។',
      view_notifications: 'មើលការជូនដំណឹង',
      view_all_notifications: 'មើលការជូនដំណឹងទាំងអស់', // TODO(km-review)
      category_academic_degree: 'សញ្ញាបត្រសិក្សា',
      category_employment_record: 'ការងារ', // TODO(km-review)
      category_other: 'ផ្សេងៗ',
      see_all: 'មើលទាំងអស់ ({count})',
      all_count: 'ទាំងអស់ {count}',
      verified: '✓ បានផ្ទៀងផ្ទាត់',
      verified_label: 'បានផ្ទៀងផ្ទាត់', // TODO(km-review)
      encrypted_certificate_fallback: 'លិខិតបញ្ជាក់ដែលបានគ្រីប', // TODO(km-review)
      institution_unknown: 'ស្ថាប័ន', // TODO(km-review)
      issued_by: 'ចេញដោយ៖ ',
      year: 'ឆ្នាំ៖ ',
      issued_on: 'ថ្ងៃចេញ៖ ',
      issued_on_label: 'ថ្ងៃចេញ', // TODO(km-review)
      year_label: 'ឆ្នាំ',
      share_label: 'បានចែករំលែក', // TODO(km-review)
      seal_label: 'SEAL', // intentionally not translated — mono technical mark, same as the mockup
      unlock_vault_title: 'បើកសោកាបូបរបស់អ្នក',
      unlock_vault_desc: 'សោអ៊ិនគ្រីបរបស់អ្នកត្រូវបានបង្កើតក្នុងឧបករណ៍នេះ។ សូមបើកសោកាបូបរបស់អ្នកដើម្បីដំណើរការវិញ្ញាបនបត្រនេះ។',
      enter_pin: 'បញ្ចូលលេខកូដសម្ងាត់កាបូប',
      unlock_with_pin: 'បើកសោដោយប្រើលេខកូដ',
      cancel: 'បោះបង់',
      authenticating: 'កំពុងផ្ទៀងផ្ទាត់...',
      biometric_prompt: 'សូមបញ្ជាក់អត្តសញ្ញាណជីវមាត្រនៅលើឧបករណ៍របស់អ្នក',
      biometric_failed: 'មិនមានការស្នើសុំអត្តសញ្ញាណជីវមាត្រទេ។',
      try_again: 'ព្យាយាមម្តងទៀត',
      unlock_with_passkey: 'បើកសោដោយប្រើ Passkey',
      setup_required_title: 'ទាមទារកាបូបសុវត្ថិភាព',
      setup_required_desc: 'ដើម្បីទទួលយកវិញ្ញាបនបត្រ អ្នកត្រូវបង្កើតកាបូបសុវត្ថិភាពលើកម្មវិធីរុករករបស់អ្នកជាមុនសិន។ វាបង្កើតសោក្នុងឧបករណ៍នេះដើម្បីការពារទិន្នន័យរបស់អ្នក ដូច្នេះ Supabase រក្សាទុកតែអត្ថបទអ៊ិនគ្រីបប៉ុណ្ណោះ។',
      setup_vault_btn: 'រៀបចំកាបូបសុវត្ថិភាព',
      back_to_wallet: 'ត្រឡប់ទៅកាបូបវិញ',
      no_credentials_found: 'រកមិនឃើញវិញ្ញាបនបត្រទេ',
      unlocking: 'កំពុងបើកសោ...',
      loading_single: 'កំពុងផ្ទុកវិញ្ញាបនបត្រ...',
      credential_not_found: 'រកមិនឃើញវិញ្ញាបនបត្រទេ',
      return_to_wallet: 'ត្រឡប់ទៅកាបូបវិញ',
      share_credential: 'ចែករំលែកវិញ្ញាបនបត្រ',
      metadata_view: 'ព័ត៌មានលម្អិតនៃវិញ្ញាបនបត្រ',
      encrypted_detail_msg: 'វិញ្ញាបនបត្រនេះត្រូវបានអ៊ិនគ្រីប។ សូមបើកសោកាបូបរបស់អ្នកដើម្បីមើលព័ត៌មានពិតប្រាកដ។',
      unlock_vault_to_view: 'បើកសោកាបូបដើម្បីមើលព័ត៌មានលម្អិត',
      decrypting_claims: 'កំពុងបកប្រែទិន្នន័យពីកាបូប...',
      pdf_not_supported: 'កម្មវិធីរុករករបស់អ្នកមិនគាំទ្រការមើលឯកសារ PDF ផ្ទាល់ទេ។',
      download_pdf: 'ទាញយកឯកសារ PDF',
      failed_document_preview: 'បរាជ័យក្នុងការផ្ទុករូបភាពឯកសារ។',
      download_file: 'ទាញយកឯកសារ',
      view_full_screen: 'មើលពេញអេក្រង់',
      no_document: 'គ្មានឯកសារ',
      student_info: 'ព័ត៌មានសិស្ស',
      student_name: 'ឈ្មោះ៖',
      student_email: 'អ៊ីមែល៖',
      student_id: 'អត្តលេខសិស្ស៖',
      credential_info: 'ព័ត៌មានវិញ្ញាបនបត្រ',
      degree_type: 'ប្រភេទសញ្ញាបត្រ៖',
      major: 'ជំនាញ៖',
      graduation_date: 'ថ្ងៃបញ្ចប់ការសិក្សា៖',
      certificate_id: 'លេខសម្គាល់វិញ្ញាបនបត្រ៖',
      detail_issued_by: 'ចេញដោយ៖',
      issuer_did: 'លេខសម្គាល់ស្ថាប័ន (DID)៖',
      encrypted_badge: 'ត្រូវបានអ៊ិនគ្រីបក្នុងកាបូប',
      no_printed_copy: 'ស្ថាប័នមិនបានចុះហត្ថលេខាលើច្បាប់បោះពុម្ពនៃលិខិតនេះទេ។', // TODO(km-review)
      decline_btn: 'បដិសេធ', // TODO(km-review)
      decline_confirm: 'បដិសេធលិខិតនេះ? វានឹងមិនត្រូវបានបន្ថែមទៅកាបូបរបស់អ្នកទេ ហើយការផ្តល់ជូននឹងត្រូវលុប។ ប្រសិនបើអ្នកចង់បាន សូមស្នើឱ្យអ្នកចេញផ្ញើម្តងទៀត។', // TODO(km-review)
      raw_token_trigger: 'កម្រិតខ្ពស់៖ នាំចេញវិញ្ញាបនបត្រពេញលេញ', // TODO(km-review)
      raw_token_modal_title: 'ការនាំចេញវិញ្ញាបនបត្រពេញលេញ', // TODO(km-review)
      raw_token_modal_subtitle: 'សម្រាប់អ្នកអភិវឌ្ឍ ឬការត្រួតពិនិត្យ', // TODO(km-review)
      raw_token_modal_warning: 'វារួមបញ្ចូលគ្រប់វាល័យទាំងអស់ដោយគ្មានការបង្ហាញជ្រើសរើស។ ដើម្បីគ្រប់គ្រងអ្វីដែលអ្នកចែករំលែក សូមប្រើមុខងារ ចែករំលែក។', // TODO(km-review)
      trust_accredited_institution: 'ស្ថាប័នទទួលស្គាល់', // TODO(km-review)
      trust_encrypted_vault: 'អ៊ិនគ្រីបក្នុងកាបូប', // TODO(km-review)
      share_count_label: 'បានចែករំលែក {count} ដង', // TODO(km-review)
      not_specified: 'មិនបានបញ្ជាក់',
      issue_date_label: 'ថ្ងៃចេញ',
      no_decrypted_claims: 'រកមិនឃើញព័ត៌មានដែលបានបកប្រែទេ។',
      cancel_and_go_back: 'បោះបង់ និងត្រឡប់ក្រោយ',
      decryption_failed: 'ការបកប្រែទិន្នន័យបរាជ័យ',
      share_heading: 'ចែករំលែកវិញ្ញាបនបត្រ',
      share_subheading: 'ជ្រើសរើសអ្វីដែលត្រូវបង្ហាញ និងរយៈពេលដែលតំណចែករំលែកអាចប្រើបាន',
      step_configure: 'រៀបចំ',
      step_generate: 'បង្កើត',
      choose_what_to_share: 'ជ្រើសរើសអ្វីដែលត្រូវចែករំលែក',
      choose_what_to_share_desc: 'និយោជកនឹងឃើញតែព័ត៌មានដែលអ្នកបានជ្រើសរើសប៉ុណ្ណោះ។ ព័ត៌មានដែលលាក់នឹងមិនមាននៅក្នុងតំណចែករំលែកនេះទេ។',
      always_shown: 'តែងតែបង្ហាញ',
      institution_name: 'ឈ្មោះស្ថាប័ន',
      degree_title: 'ឈ្មោះសញ្ញាបត្រ',
      issue_date: 'ថ្ងៃចេញ',
      sensitive: 'រសើប',
      private: 'ឯកជន',
      sharing_fields: 'កំពុងចែករំលែក {disclosed} នៃ {total} ព័ត៌មាន',
      hidden_fields: 'បានលាក់៖ {fields}',
      will_be_hidden: 'នឹងត្រូវលាក់',
      who_is_this_for: 'តើនេះសម្រាប់នរណា? (ស្រេចចិត្ត)',
      recipient_placeholder: 'ឧ. ក្រុមហ៊ុន Acme ផ្នែកធនធានមនុស្ស',
      single_use: 'អនុញ្ញាតឱ្យមើលបានតែម្តង', // TODO(km-review)
      single_use_desc: 'តំណនឹងឈប់ដំណើរការបន្ទាប់ពីការមើលលើកដំបូង។ ប្រើវានៅពេលអ្នកមិនចង់ឱ្យវាត្រូវបានបញ្ជូនបន្ត។', // TODO(km-review)
      how_long_active: 'តើតំណនេះគួរដំណើរការរយៈពេលប៉ុន្មាន?',
      duration_desc: 'ជ្រើសរើសរយៈពេលរហ័ស ឬកំណត់ថ្ងៃផុតកំណត់។',
      day_1: '១ ថ្ងៃ',
      days_7: '៧ ថ្ងៃ',
      days_30: '៣០ ថ្ងៃ',
      days_90: '៩០ ថ្ងៃ',
      custom: 'កំណត់ដោយខ្លួនឯង',
      choose_expiration_date: 'ជ្រើសរើសថ្ងៃផុតកំណត់',
      link_expires_on: 'តំណផុតកំណត់នៅ៖',
      expiry_warning: 'បន្ទាប់ពីផុតកំណត់ តំណនេះនឹងឈប់ដំណើរការ។ និយោជកមិនអាចបើកវាឡើងវិញបានទេ។ អ្នកតែងតែអាចបង្កើតតំណចែករំលែកថ្មីមួយទៀតបាន។',
      create_share_link: 'បង្កើតតំណចែករំលែក',
      share_link_created: 'តំណចែករំលែកត្រូវបានបង្កើត',
      copy_link: 'ចម្លងតំណ',
      copy: 'ចម្លង',
      copied: 'បានចម្លង!',
      copy_failed: 'បរាជ័យក្នុងការចម្លង។',
      open: 'បើក',
      download_qr_png: 'ទាញយករូបភាព QR',
      email_employer: 'អ៊ីមែលទៅនិយោជក',
      disclosed_fields: 'ព័ត៌មានដែលបានបង្ហាញ៖',
      expires: 'ផុតកំណត់៖',
      token: 'កូដសម្ងាត់៖',
      share_warning: 'អ្នកដែលមានតំណនេះអាចផ្ទៀងផ្ទាត់វិញ្ញាបនបត្ររបស់អ្នករហូតដល់វាផុតកំណត់។ សូមកុំចែករំលែកវាជាសាធារណៈ។',
      no_active_share_link: 'មិនមានតំណចែករំលែកដែលសកម្មត្រូវបានបង្កើតក្នុងអំឡុងពេលនេះទេ។',
      go_to_configure_step: 'ទៅកាន់ការរៀបចំ',
      view_past_share_links: 'មើលតំណចែករំលែកពីមុនរបស់អ្នកទាំងអស់នៅក្នុង ',
      activity: 'សកម្មភាព',
      unlock_vault_to_continue: 'បើកសោកាបូបរបស់អ្នកដើម្បីបន្ត',
      unlock_vault_desc_passkey: 'ចុច "បើកសោកាបូប" — ឧបករណ៍របស់អ្នកនឹងស្នើសុំការបញ្ជាក់អត្តសញ្ញាណជីវមាត្រ។',
      unlock_vault_desc_pin: 'បញ្ចូលលេខកូដកាបូបរបស់អ្នកដើម្បីជ្រើសរើសព័ត៌មានដែលត្រូវចែករំលែក។',
      unlock_vault_btn: 'បើកសោកាបូប',
      unlock_vault_modal_desc: 'សោអ៊ិនគ្រីបរបស់អ្នកត្រូវបានបង្កើតក្នុងឧបករណ៍នេះ។ សូមបើកសោកាបូបដើម្បីបន្តដំណើរការ។',
      enter_vault_pin: 'បញ្ចូលលេខកូដកាបូប',
      share_revoked_success: 'តំណចែករំលែកត្រូវបានដកហូតដោយជោគជ័យ',
      share_revoke_failed: 'បរាជ័យក្នុងការដកហូតតំណចែករំលែក',
      cannot_extend_inactive: 'មិនអាចបន្តបានទេ៖ តំណចែករំលែកនេះមិនសកម្មទៀតទេ',
      share_extend_success: 'តំណចែករំលែកត្រូវបានបន្តដោយជោគជ័យ',
      share_extend_failed: 'បរាជ័យក្នុងការបន្តតំណចែករំលែក',
      share_activity_title: 'សកម្មភាពចែករំលែក',
      share_activity_desc: 'រាល់តំណដែលអ្នកបានបង្កើត។ នីមួយៗគឺដាច់ដោយឡែកពីគ្នា — អ្នកអាចដកហូតវិញនៅពេលណាក៏បាន។',
      loading_activity: 'កំពុងផ្ទុកសកម្មភាពរបស់អ្នក...',
      failed_load_activity: 'បរាជ័យក្នុងការផ្ទុកសកម្មភាព',
      no_share_links_yet: 'មិនទាន់មានតំណចែករំលែកទេ',
      no_share_links_desc: 'នៅពេលអ្នកចែករំលែកវិញ្ញាបនបត្រពីកាបូបរបស់អ្នក តំណដែលបានបង្កើតនឹងបង្ហាញនៅទីនេះ ដូច្នេះអ្នកអាចតាមដានថាអ្នកណាមានសិទ្ធិមើល។',
      status_active: 'សកម្ម',
      status_expired: 'ផុតកំណត់',
      status_revoked: 'បានដកហូត',
      share_link_default_title: 'តំណចែករំលែក',
      no_extra_fields: 'មិនមានព័ត៌មានបន្ថែម',
      expires_on: 'ផុតកំណត់ ',
      expired_on: 'បានផុតកំណត់ ',
      revoked_on: 'បានដកហូត ',
      extend_btn: 'បន្ត',
      revoke_btn: 'ដកហូត',
      revoke_confirm_msg: 'តើអ្នកប្រាកដជាចង់ដកហូតតំណនេះមែនទេ?',
      extend_link_expiry: 'បន្តសុពលភាពតំណ',
      plus_1_day: '+១ ថ្ងៃ',
      plus_7_days: '+៧ ថ្ងៃ',
      plus_30_days: '+៣០ ថ្ងៃ',
      plus_90_days: '+៩០ ថ្ងៃ',
      new_expiry: 'ថ្ងៃផុតកំណត់ថ្មី៖ ',
      confirm_btn: 'បញ្ជាក់',
      field_name: 'ឈ្មោះពេញ',
      field_year: 'ឆ្នាំបញ្ចប់ការសិក្សា',
      field_gpa: 'មធ្យមភាគពិន្ទុ',
      field_national_id: 'អត្តសញ្ញាណប័ណ្ណ',
      field_notes: 'កំណត់សម្គាល់បន្ថែម',
      field_email: 'អាសយដ្ឋានអ៊ីមែល',
      field_student_id: 'អត្តលេខសិស្ស',
      field_graduation_date: 'ថ្ងៃបញ្ចប់ការសិក្សា',
      field_certificate_id: 'លេខសម្គាល់វិញ្ញាបនបត្រ',
      field_photo: 'រូបថតសិស្ស',
      field_degree: 'ឈ្មោះសញ្ញាបត្រ',
      field_institution: 'ស្ថាប័ន',
      field_issue_date: 'ថ្ងៃចេញ',
      vault_unlock_failed: 'ការបើកកាបូបបរាជ័យ។ សូមពិនិត្យលេខកូដរបស់អ្នក។',
      vault_unlock_error: 'មានបញ្ហាក្នុងការបើកកាបូប។ សូមព្យាយាមម្តងទៀត។',
      passkey_auth_failed: 'ការបញ្ជាក់អត្តសញ្ញាណ Passkey បរាជ័យ។',
      passkey_error: 'មានបញ្ហា Passkey។',
      cred_save_failed: 'វិញ្ញាបនបត្រត្រូវបានអ៊ិនគ្រីប ប៉ុន្តែបរាជ័យក្នុងការរក្សាទុក។ សូមព្យាយាមម្តងទៀត។',
      cred_claim_success: 'វិញ្ញាបនបត្រត្រូវបានទទួល និងអ៊ិនគ្រីបដោយជោគជ័យ!',
      notifications_title: 'ការជូនដំណឹង',
      notifications_desc: 'ទទួលវិញ្ញាបនបត្រដែលបានចេញឲ្យអត្តសញ្ញាណឌីជីថលកម្ពុជារបស់អ្នក',
      checking_pending_credentials: 'កំពុងត្រួតពិនិត្យវិញ្ញាបនបត្រដែលរង់ចាំ...',
      failed_load_notifications: 'បរាជ័យក្នុងការផ្ទុកការជូនដំណឹង',
      refresh_to_try_again: 'សូមផ្ទុកទំព័រឡើងវិញដើម្បីព្យាយាមម្តងទៀត។',
      retry_btn: 'ព្យាយាមម្តងទៀត',
      all_caught_up: 'បានទទួលទាំងអស់ហើយ!',
      no_pending_credentials_desc: 'អ្នកមិនមានវិញ្ញាបនបត្រដែលត្រូវទទួលនៅពេលនេះទេ។ ស្ថាប័ននឹងចេញវិញ្ញាបនបត្រឌីជីថលដោយផ្ទាល់ទៅកាន់អត្តសញ្ញាណរបស់អ្នក។',
      claim_to_vault_btn: 'ទទួលចូលកាបូប',
      claim_failed_msg: 'ការទទួលបរាជ័យ៖ ',
      claim_refused_msg: 'មិនបានបញ្ចូលទៅក្នុងកាបូបរបស់អ្នក៖ ', // TODO(km-review)
      unlock_and_claim_btn: 'បើកសោ និងទទួល',
      auth_biometric_desc: 'បញ្ជាក់អត្តសញ្ញាណដោយប្រើជីវមាត្រក្នុងឧបករណ៍របស់អ្នក។',
      auth_passkey_desc: 'បញ្ជាក់អត្តសញ្ញាណដោយប្រើ Passkey ក្នុងឧបករណ៍របស់អ្នក។',
      unlock_with_biometric: 'បើកសោដោយជីវមាត្រ',
      vault_setup_required_title: 'តម្រូវឲ្យរៀបចំកាបូប',
      vault_setup_required_desc: 'វិញ្ញាបនបត្រឌីជីថលរបស់អ្នកត្រូវបានអ៊ិនគ្រីបក្នុងឧបករណ៍ដើម្បីរក្សាភាពឯកជន។ អ្នកត្រូវតែរៀបចំកាបូបរបស់អ្នកដើម្បីរក្សាទុកវា។',
      setup_my_vault_btn: 'រៀបចំកាបូបរបស់ខ្ញុំ',
      vault_setup_subtitle: 'វិញ្ញាបនបត្ររបស់អ្នកត្រូវបានអ៊ិនគ្រីបជាមួយនឹងសោដែលមានតែឧបករណ៍របស់អ្នកប៉ុណ្ណោះដែលមាន',
      step_choose_method: 'ជ្រើសរើសវិធីសាស្ត្រ',
      step_create_vault: 'បង្កើតកាបូប',
      step_done: 'រួចរាល់',
      how_to_unlock: 'តើអ្នកចង់បើកកាបូបរបស់អ្នកដោយរបៀបណា?',
      recommended_badge: 'បានណែនាំ',
      biometric_title: 'ជីវមាត្រ',
      biometric_desc: 'ប្រើប្រាស់ Face ID, Touch ID ឬ Windows Hello។ លឿន សុវត្ថិភាព និងស្ថិតនៅលើឧបករណ៍នេះ។',
      bio_feature_1: 'ដំណើរការជីវមាត្រភ្លាមៗ',
      bio_feature_2: 'មិនត្រូវការសោខាងក្រៅទេ',
      bio_feature_3: 'សុវត្ថិភាពខ្ពស់ & ក្នុងម៉ាស៊ីន',
      pin_title: 'លេខកូដ ៦ ខ្ទង់',
      pin_desc: 'កំណត់លេខកូដ ៦ ខ្ទង់ដើម្បីបើកកាបូបនៅលើកម្មវិធីបើកអ៊ីនធឺណិតណាមួយ។',
      pin_feature_1: 'ប្រើបានលើគ្រប់ឧបករណ៍',
      pin_feature_2: 'ងាយស្រួលក្នុងការកំណត់',
      pin_feature_3: 'មិនត្រូវការឧបករណ៍បន្ថែម',
      create_pin: 'បង្កើតលេខកូដ ៦ ខ្ទង់របស់អ្នក',
      confirm_pin: 'បញ្ជាក់លេខកូដរបស់អ្នក',
      pin_mismatch: 'លេខកូដមិនត្រូវគ្នាទេ។',
      bio_setup_notice: 'ការរៀបចំជីវមាត្រត្រូវបានធ្វើឡើងក្នុងម៉ាស៊ីន។ ឧបករណ៍របស់អ្នកនឹងស្នើសុំនៅពេលអ្នកបន្ត។',
      go_back: 'ត្រឡប់ក្រោយ',
      continue_btn: 'បន្ត',
      creating_keys: 'កំពុងបង្កើតសោកាបូប...',
      creating_keys_desc: 'សូមរង់ចាំខណៈពេលដែលយើងកំពុងរៀបចំកាបូបរបស់អ្នក។ សូមកុំបិទទំព័រនេះ។',
      passkey_failed_title: 'ការបង្កើត Passkey បរាជ័យ។',
      passkey_failed_desc: 'មិនអាចរៀបចំ Passkey ក្នុងម៉ាស៊ីនបានទេ។ សូមព្យាយាមម្តងទៀត។',
      vault_ready_title: 'កាបូបរបស់អ្នករួចរាល់ហើយ!',
      vault_ready_desc: 'វិញ្ញាបនបត្រឌីជីថលរបស់អ្នកឥឡូវនេះអាចទទួលនិងឌីគ្រីបដោយសុវត្ថិភាពក្នុងម៉ាស៊ីន។',
      return_wallet_btn: 'ត្រឡប់ទៅកាបូបវិញ',
      sec_recs: 'អនុសាសន៍សុវត្ថិភាព៖',
      sec_recs_desc: 'ប្រើប្រាស់ Passkey ឧបករណ៍សម្រាប់សុវត្ថិភាពជីវមាត្រ។ សូមចងចាំថា Actik ប្រើការអ៊ិនគ្រីប zero-knowledge៖ ប្រសិនបើអ្នកភ្លេចលេខកូដ អ្នកនឹងមិនអាចទាញយកវិញបានទេ។ កុំចែករំលែកសោសុវត្ថិភាពរបស់អ្នកឲ្យសោះ។',
      show_pin_digits: 'បង្ហាញលេខកូដ',
      pin_mismatch_error: '❌ លេខកូដមិនត្រូវគ្នាទេ',
      pin_matches: '✓ លេខកូដត្រូវគ្នា',
      how_it_works: 'តើវាដំណើរការយ៉ាងដូចម្តេច?',
      creating_your_vault: 'កំពុងបង្កើតកាបូបរបស់អ្នក',
      confirm_with_device: 'កម្មវិធីបើកអ៊ីនធឺណិតរបស់អ្នកនឹងស្នើសុំឱ្យបញ្ជាក់ជាមួយ',
      generating_key: 'កំពុងបង្កើតសោអ៊ិនគ្រីប...',
      creating_envelope: 'កំពុងបង្កើតស្រោមសោ...',
      saving_actik: 'កំពុងរក្សាទុកក្នុង Actik...',
      verifying_vault: 'កំពុងផ្ទៀងផ្ទាត់កាបូប...',
      vault_creation_failed: 'ការបង្កើតកាបូបបរាជ័យ៖',
      vault_protected_by: 'វិញ្ញាបនបត្ររបស់អ្នកឥឡូវនេះត្រូវបានការពារដោយ',
      pin_passcode: 'លេខកូដ PIN',
      biometrics_touch: 'ជីវមាត្រ (Touch ID / Face ID)',
      only_you_open: 'មានតែអ្នកទេដែលអាចបើកកាបូបនេះបាន',
      only_you_open_desc: '— សូម្បីតែ Actik ក៏មិនអាចអានវិញ្ញាបនបត្រ ឬចូលប្រើសោឯកជនរបស់អ្នកបានដែរ។',
      if_lose_access: 'ប្រសិនបើអ្នកបាត់បង់សិទ្ធិចូលប្រើ',
      if_lose_access_desc: 'ចំពោះលេខកូដសង្គ្រោះ សូមទាក់ទងសាកលវិទ្យាល័យឬក្រសួងរបស់អ្នកដើម្បីចេញវិញ្ញាបនបត្រឡើងវិញ។',
      backup_methods: 'វិធីសាស្រ្តបម្រុងទុក៖',
      backup_methods_desc: 'អ្នកអាចបន្ថែមលេខកូដបម្រុងទុក ឬគ្រប់គ្រងសោនៅក្នុងការកំណត់ពេលក្រោយ។',
      return_wallet_claim: 'ត្រឡប់ទៅកាបូបដើម្បីទទួលវិញ្ញាបនបត្ររបស់អ្នក',
      go_dashboard: 'ទៅកាន់ផ្ទាំងគ្រប់គ្រង',
      delete_vault_warning: 'នេះនឹងលុបកាបូបរបស់អ្នកចោល',
      reset_vault_desc: 'ការកំណត់កាបូបឡើងវិញនឹងលុបវិញ្ញាបនបត្រដែលបានអ៊ិនគ្រីបទាំងអស់ជារៀងរហូត។ អ្នកនឹងត្រូវទទួលវិញ្ញាបនបត្រឡើងវិញពីស្ថាប័នរបស់អ្នក។ សកម្មភាពនេះមិនអាចត្រឡប់ថយក្រោយបានទេ។',
      type_reset_confirm: 'វាយបញ្ចូល RESET ដើម្បីបញ្ជាក់',
      reset_btn: 'កំណត់ឡើងវិញ',
      change_unlock_method_q: 'ផ្លាស់ប្តូរវិធីសាស្ត្របើកកាបូបមែនទេ?',
      change_unlock_desc: 'ការផ្លាស់ប្តូរវិធីសាស្ត្របើកកាបូបតម្រូវឱ្យបង្កើតសោក្នុងម៉ាស៊ីនថ្មី។ វិញ្ញាបនបត្រណាមួយដែលកំពុងរក្សាទុកក្នុងកាបូបរបស់អ្នកនឹងត្រូវអ៊ិនគ្រីបឡើងវិញ ឬទទួលម្តងទៀត។',
      proceed_reconfigure: 'បន្តដើម្បីរៀបចំឡើងវិញ'
    },
    dashboard: {
      loading_dashboard: 'កំពុងទាញយកព័ត៌មានផ្ទាំងគ្រប់គ្រង...',
      register_institution: 'ចុះឈ្មោះស្ថាប័ន',
      register_desc: 'ចូលរួមបញ្ជីអត្តសញ្ញាណជឿទុកចិត្តកម្ពុជា។ បន្ទាប់ពីបានចុះឈ្មោះនិងទទួលស្គាល់ដោយក្រសួងអប់រំ យុវជន និងកីឡា អ្នកអាចចេញវិញ្ញាបនបត្រឌីជីថលសុវត្ថិភាព។',
      institution_name: 'ឈ្មោះស្ថាប័ន',
      domain_name: 'ឈ្មោះដែន (Domain name)',
      domain_desc: 'ដែននេះបង្កើតអត្តសញ្ញាណ did:web របស់អ្នក (ឧ. did:web:rupp.edu.kh) ដើម្បីបញ្ជាក់វិញ្ញាបនបត្ររបស់អ្នក។',
      institution_type: 'ប្រភេទស្ថាប័ន',
      select_type: 'ជ្រើសរើសប្រភេទ...',
      university: 'សាកលវិទ្យាល័យ',
      ministry: 'ក្រសួង',
      training_centre: 'មជ្ឈមណ្ឌលបណ្តុះបណ្តាល',
      other: 'ផ្សេងៗ',
      register_btn: 'ចុះឈ្មោះស្ថាប័ន',
      issuer_dashboard: 'ផ្ទាំងគ្រប់គ្រងស្ថាប័ន',
      manage_desc: 'គ្រប់គ្រងវិញ្ញាបនបត្ររបស់អ្នក និងមើលការកំណត់ស្ថាប័ន។',
      awaiting_approval: 'រង់ចាំការយល់ព្រមពីក្រសួងអប់រំ យុវជន និងកីឡា',
      awaiting_desc: 'សំណើចុះឈ្មោះស្ថាប័នរបស់អ្នកត្រូវបានបញ្ជូន។ ក្រសួងអប់រំ យុវជន និងកីឡានឹងត្រួតពិនិត្យនិងទទួលស្គាល់ទម្រង់របស់អ្នកក្នុងពេលឆាប់ៗ។',
      awaiting_note: 'ចំណាំ៖ អ្នកនឹងត្រូវបានអនុញ្ញាតឱ្យចេញវិញ្ញាបនបត្រឌីជីថលនៅពេលដែលទម្រង់របស់អ្នកត្រូវបានបញ្ជាក់ថាបានទទួលស្គាល់នៅក្នុងប្រព័ន្ធ។',
      key_expired: 'សោចុះហត្ថលេខាគ្រីបថូត្រូវបានផុតកំណត់',
      key_expired_desc1: 'ដើម្បីអនុលោមតាមបទប្បញ្ញត្តិ និងសុវត្ថិភាពកាបូប សោចុះហត្ថលេខាឯកជនរបស់អ្នកត្រូវបានរក្សាទុកក្នុងកម្មវិធីរុករកនេះ។ ការបិទទំព័រ ផ្ទុកទំព័រឡើងវិញ ឬអស់ពេលនឹងលុបវាចេញពីអង្គចងចាំ។',
      key_expired_desc2: 'ដើម្បីចាប់ផ្តើមចេញវិញ្ញាបនបត្រ សូមបង្កើតសោចុះហត្ថលេខារបស់អ្នកឡើងវិញនិងធ្វើបច្ចុប្បន្នភាពបញ្ជីសាធារណៈ។',
      regenerate_keys: 'បង្កើតសោឡើងវិញ & ធ្វើបច្ចុប្បន្នភាព',
      issue_credential: 'ចេញវិញ្ញាបនបត្រ',
      issue_credential_desc: 'ជ្រើសរើសប្រភេទវិញ្ញាបនបត្រនិងចេញវិញ្ញាបនបត្រឌីជីថលដែលអាចផ្ទៀងផ្ទាត់បានទៅឲ្យនិស្សិត។',
      start_issuance: 'ចាប់ផ្តើមការចេញ',
      issued_creds: 'វិញ្ញាបនបត្រដែលបានចេញ',
      issued_creds_desc: 'វិញ្ញាបនបត្រដែលអ្នកបានចេញជូននិស្សិត។',
      no_creds_issued: 'មិនទាន់មានវិញ្ញាបនបត្របានចេញនៅឡើយទេ',
      no_creds_issued_desc: 'នៅពេលអ្នកចេញវិញ្ញាបនបត្រ វានឹងបង្ហាញនៅទីនេះ។',
      academic_degrees: 'សញ្ញាបត្រសិក្សា',
      other_credentials: 'វិញ្ញាបនបត្រផ្សេងៗ',
      see_all: 'មើលទាំងអស់',
      status_claimed: 'បានទទួល',
      status_issued: 'បានចេញ', // TODO(km-review)
      status_withdrawn: 'បានដកហូត', // TODO(km-review)
      manage_withdrawals: 'ដកហូតវិញ្ញាបនបត្រ ឬបន្តបញ្ជីដកហូតរបស់អ្នក', // TODO(km-review)
      status_pending: 'រង់ចាំ',
      stat_total_issued: 'ចេញសរុប', // TODO(km-review)
      stat_claimed: 'បានទទួល', // TODO(km-review)
      stat_pending: 'រង់ចាំទទួល', // TODO(km-review)
      stat_verifications: 'ការផ្ទៀងផ្ទាត់', // TODO(km-review)
      stat_verifications_sub: 'ដោយនិយោជក', // TODO(km-review)
      accredited_pill: 'ទទួលស្គាល់', // TODO(km-review)
      pending_approval_pill: 'រង់ចាំការយល់ព្រម', // TODO(km-review)
      recent_issuances: 'លិខិតចេញថ្មីៗ', // TODO(km-review)
      table_holder: 'អ្នកទទួល', // TODO(km-review)
      table_credential: 'លិខិត', // TODO(km-review)
      table_issued: 'ចេញនៅ', // TODO(km-review)
      table_status: 'ស្ថានភាព', // TODO(km-review)
      issuance_volume: 'ការចេញលិខិត ៦ខែ', // TODO(km-review)
      signing_key_active: 'កូនសោសកម្ម', // TODO(km-review)
      save_as_draft_btn: 'រក្សាទុកជាព្រាង', // TODO(km-review)
      draft_found_title: 'អ្នកមានព្រាងមិនទាន់រក្សាទុក', // TODO(km-review)
      draft_found_desc: 'បានរក្សាទុកនៅ', // TODO(km-review)
      resume_draft_btn: 'បន្តព្រាង', // TODO(km-review)
      discard_draft_btn: 'បោះបង់', // TODO(km-review)
      draft_saved_toast: 'បានរក្សាទុកព្រាង — អាចបន្តនៅពេលណាក៏បានពី ចេញលិខិត។', // TODO(km-review)
      draft_card_title: 'វិញ្ញាបនបត្រព្រាងកំពុងដំណើរការ', // TODO(km-review)
      continue_editing_btn: 'បន្តកែសម្រួល', // TODO(km-review)
      back_to_issued: 'ត្រឡប់ទៅវិញ្ញាបនបត្រដែលបានចេញ',
      no_creds_in_category: 'រកមិនឃើញវិញ្ញាបនបត្រក្នុងប្រភេទនេះទេ។',
      checking_auth: 'កំពុងត្រួតពិនិត្យការអនុញ្ញាត...',
      inst_not_registered: 'ស្ថាប័នមិនទាន់បានចុះឈ្មោះ',
      inst_not_registered_desc: 'អ្នកត្រូវចុះឈ្មោះទម្រង់ស្ថាប័នរបស់អ្នក មុនពេលអ្នកអាចចូលប្រើផ្ទាំងចេញវិញ្ញាបនបត្រ។',
      awaiting_desc_issue: 'ទម្រង់ស្ថាប័នរបស់អ្នកត្រូវបានចុះឈ្មោះ ប៉ុន្តែមិនទាន់ត្រូវបានទទួលស្គាល់ដោយក្រសួងអប់រំ យុវជន និងកីឡានៅឡើយទេ។',
      awaiting_note_issue: 'អ្នកមិនអាចចេញវិញ្ញាបនបត្រឌីជីថលទេរហូតដល់ការអនុម័តទទួលស្គាល់ត្រូវបានផ្តល់ជូន។',
      back_to_dashboard: 'ត្រឡប់ទៅផ្ទាំងគ្រប់គ្រង',
      session_expired: 'សោចុះហត្ថលេខាផុតកំណត់',
      session_expired_desc1: 'សោចុះហត្ថលេខាគ្រីបថូរបស់អ្នកលែងមានក្នុងកម្មវិធីរុករកនេះហើយ។ នេះកើតឡើងនៅពេលអ្នកបិទទំព័រ ផ្ទុកទំព័រឡើងវិញ ឬអស់ពេល។',
      session_expired_desc2: 'ចំណាំ៖ ការចុះឈ្មោះស្ថាប័នរបស់អ្នកនៅតែមានសុវត្ថិភាព។ អ្នកគ្រាន់តែចូលគណនី Google របស់អ្នកម្តងទៀតដើម្បីទាញយកសោនេះឡើងវិញ។',
      sign_out_back_in: 'ចាកចេញ ហើយចូលម្តងទៀត',
      credential_issued: 'វិញ្ញាបនបត្រត្រូវបានចេញ',
      review_title: 'ពិនិត្យមើលមុននឹងចេញ',
      review_desc: 'សូមពិនិត្យលម្អិតខាងក្រោមម្តងទៀត។ នៅពេលចេញផ្សាយហើយ វិញ្ញាបនបត្រនេះនឹងត្រូវបានចុះហត្ថលេខាគ្រីបថូ ហើយមិនអាចកែប្រែបានទេ។',
      confirm_issue_btn: 'បញ្ជាក់ និងចេញ',
      back_to_edit: 'ត្រឡប់ទៅកែសម្រួល',
      student_email: 'អ៊ីមែលនិស្សិត',
      degree_cert_label: 'សញ្ញាបត្រ',
      institution: 'ស្ថាប័ន',
      issue_success_active: 'និស្សិតមានគណនីសកម្ម។ ពួកគេនឹងឃើញវិញ្ញាបនបត្រនេះក្នុងកាបូបរបស់ពួកគេភ្លាមៗ ហើយអាចទទួលវាបាន។',
      issue_success_pending: 'វិញ្ញាបនបត្រត្រូវបានរក្សាទុកក្នុងបញ្ជីរង់ចាំ។ និស្សិតអាចទទួលវាបាននៅពេលពួកគេចុះឈ្មោះគណនី Actik ដោយប្រើអ៊ីមែលនេះ។',
      issue_another: 'ចេញវិញ្ញាបនបត្រមួយទៀត',
      issue_credential_title: 'ចេញវិញ្ញាបនបត្រ',
      step_type: 'ប្រភេទ', // TODO(km-review)
      live_preview: 'មើលជាមុន', // TODO(km-review)
      degree_preview_placeholder: 'ជ្រើសរើសប្រភេទសញ្ញាបត្រ…', // TODO(km-review)
      credential_preview_placeholder: 'ចំណងជើងវិញ្ញាបនបត្រ', // TODO(km-review)
      issue_credential_desc_form: 'ចុះហត្ថលេខានិងផ្ញើវិញ្ញាបនបត្រឌីជីថលទៅនិស្សិត។',
      signing_as: 'ចុះហត្ថលេខាជា៖',
      type_academic: 'សញ្ញាបត្រសិក្សា',
      type_academic_desc: 'បរិញ្ញាបត្រ សញ្ញាបត្រ និងកម្មវិធីសិក្សាផ្លូវការ',
      type_attendance: 'ការចូលរួម',
      type_attendance_desc: 'សន្និសីទ សិក្ខាសាលា',
      type_completion: 'ការបញ្ចប់ និងកម្មសិក្សា',
      type_completion_desc: 'វគ្គសិក្សាខ្លី និងកម្មសិក្សា',
      type_merit: 'គុណសម្បត្តិ និងឧត្តមភាព',
      type_merit_desc: 'រង្វាន់ កិត្តិយស និងសមិទ្ធិផលពិសេស',
      type_appreciation: 'ការសរសើរ និងសេវាកម្ម',
      type_appreciation_desc: 'ការងារស្ម័គ្រចិត្ត និងសេវាកម្មសហគមន៍',
      type_professional: 'វិញ្ញាបនបត្រវិជ្ជាជីវៈ',
      type_professional_desc: 'អាជ្ញាប័ណ្ណ លិខិតអនុញ្ញាត និងវិញ្ញាបនបត្រវិជ្ជាជីវៈ',
      change_cert_type: 'ផ្លាស់ប្តូរប្រភេទវិញ្ញាបនបត្រ',
      student_section: 'ផ្នែកនិស្សិត',
      student_email_req: 'អ៊ីមែលនិស្សិត',
      student_found: '✓ រកឃើញគណនីនិស្សិត',
      student_not_found_warning: '⚠ រកមិនឃើញគណនី Actik ប្រើអ៊ីមែលនេះទេ។ វិញ្ញាបនបត្រនឹងត្រូវបានចេញ ប៉ុន្តែនជស្សិតមិនអាចទទួលវាបានទេរហូតដល់ពួកគេចុះឈ្មោះ។',
      student_check_error: '⚠ មិនអាចពិនិត្យអ៊ីមែលនេះបានទេឥឡូវនេះ។ សូមព្យាយាមម្តងទៀត — នេះខុសពី "រកមិនឃើញគណនី"។',
      full_name_req: 'ឈ្មោះពេញ',
      credential_details: 'ព័ត៌មានលម្អិតវិញ្ញាបនបត្រ',
      issuing_institution: 'ស្ថាប័នចេញ',
      degree_type_req: 'ប្រភេទសញ្ញាបត្រ',
      major_req: 'មុខជំនាញ',
      student_id_req: 'អត្តលេខនិស្សិត',
      grad_date_req: 'កាលបរិច្ឆេទបញ្ចប់',
      cert_id_req: 'លេខសម្គាល់សញ្ញាបត្រ',
      cert_doc_req: 'ឯកសារសញ្ញាបត្រ',
      cert_doc_desc: 'ផ្ទុកឡើង PDF ឬរូបភាពនៃសញ្ញាបត្រ។',
      type_req: 'ប្រភេទ',
      event_name_req: 'ឈ្មោះព្រឹត្តិការណ៍',
      event_date_req: 'កាលបរិច្ឆេទព្រឹត្តិការណ៍',
      organizer_req: 'អ្នករៀបចំ',
      role_desc_opt: 'តួនាទី / ការពិពណ៌នា (ជាជម្រើស)',
      program_name_req: 'ឈ្មោះកម្មវិធី',
      duration_opt: 'រយៈពេល (ជាជម្រើស)',
      completion_date_req: 'កាលបរិច្ឆេទបញ្ចប់',
      dept_role_opt: 'នាយកដ្ឋាន / តួនាទី (ជាជម្រើស)',
      achievement_title_req: 'ចំណងជើងសមិទ្ធិផល',
      basis_desc_req: 'មូលដ្ឋាន / ការពិពណ៌នា',
      date_awarded_req: 'កាលបរិច្ឆេទផ្តល់រង្វាន់',
      reason_req: 'មូលហេតុនៃការសរសើរ',
      capacity_opt: 'សមត្ថភាព / តួនាទី (ជាជម្រើស)',
      date_req: 'កាលបរិច្ឆេទ',
      cert_name_req: 'ឈ្មោះវិញ្ញាបនបត្រ',
      issuing_body_req: 'ស្ថាប័នចេញ',
      license_num_opt: 'លេខអាជ្ញាប័ណ្ណ (ជាជម្រើស)',
      date_certified_req: 'កាលបរិច្ឆេទបញ្ជាក់',
      expiry_date_opt: 'កាលបរិច្ឆេទផុតកំណត់ (ជាជម្រើស)',
      select_file: 'ជ្រើសរើសឯកសារ',
      change_file: 'ផ្លាស់ប្តូរឯកសារ',
      upload_another: 'ផ្ទុកឡើងមួយទៀត',
      pdf_image_limit: 'PDF ឬ រូបភាព (អតិបរមា 5MB)',
      issue_credential_btn: 'ចេញវិញ្ញាបនបត្រ',
      issuing_status: 'កំពុងចេញ...',
      additional_notes_opt: 'កំណត់សម្គាល់បន្ថែម (ជាជម្រើស)',
      remove_document: 'លុបឯកសារចេញ',
      checking_registration: 'កំពុងត្រួតពិនិត្យស្ថានភាពចុះឈ្មោះ...',
      inst_already_registered: 'ស្ថាប័នបានចុះឈ្មោះរួចហើយ',
      inst_linked_desc: 'គណនីរបស់អ្នកត្រូវបានភ្ជាប់ជាមួយទម្រង់ស្ថាប័នដូចខាងក្រោម៖',
      inst_name: 'ឈ្មោះ',
      inst_domain: 'ដែន (Domain)',
      inst_did: 'អត្តសញ្ញាណវិមជ្ឈការ (DID)',
      accredited_badge: 'ទទួលស្គាល់ដោយក្រសួងអប់រំ',
      pending_badge: 'រង់ចាំការអនុម័តពីក្រសួងអប់រំ',
      cannot_issue_until_approved: 'អ្នកមិនអាចចេញវិញ្ញាបនបត្រទេរហូតដល់ក្រសួងអប់រំអនុម័តស្ថាប័នរបស់អ្នក។',
      inst_registered: 'ស្ថាប័នត្រូវបានចុះឈ្មោះ',
      next_steps: 'ជំហានបន្ទាប់៖',
      step_added_registry: 'ស្ថាប័នរបស់អ្នកត្រូវបានបញ្ចូលទៅក្នុងបញ្ជី Actik។',
      step_moeys_review: 'ក្រសួងអប់រំនឹងពិនិត្យនិងអនុម័តស្ថាប័នរបស់អ្នក។',
      step_can_issue: 'អ្នកនឹងអាចចេញវិញ្ញាបនបត្រនៅពេលបានអនុម័ត។',
      step_key_stored: 'សោឯកជនរបស់អ្នកត្រូវបានរក្សាទុកតែក្នុងសម័យកម្មវិធីរុករកនេះប៉ុណ្ណោះ។',
      register_inst_title: 'ចុះឈ្មោះស្ថាប័នរបស់អ្នក',
      register_inst_desc: 'នៅពេលបានអនុម័តដោយក្រសួងអប់រំ ស្ថាប័នរបស់អ្នកអាចចេញវិញ្ញាបនបត្រឌីជីថល។',
      inst_name_label: 'ឈ្មោះស្ថាប័ន',
      domain_label: 'ដែន (Domain)',
      domain_help: 'ប្រើប្រាស់ដែនផ្លូវការរបស់ស្ថាប័នអ្នក។ វានឹងក្លាយជាផ្នែកមួយនៃអត្តសញ្ញាណឌីជីថលរបស់អ្នក។',
      what_is_did: 'តើអ្វីទៅជា DID?',
      did_desc1: 'DID (អត្តសញ្ញាណវិមជ្ឈការ) គឺជាអត្តសញ្ញាណឌីជីថលពិសេសសម្រាប់ស្ថាប័នរបស់អ្នក។',
      did_example: 'ឧទាហរណ៍៖ ',
      did_desc2: 'វាត្រូវបានភ្ជាប់ទៅនឹងដែនរបស់អ្នកហើយប្រើដើម្បីចុះហត្ថលេខាលើរាល់វិញ្ញាបនបត្រដែលអ្នកចេញ។',
      did_desc3: 'និយោជកអាចផ្ទៀងផ្ទាត់វិញ្ញាបនបត្រដែលបានចុះហត្ថលេខាដោយស្ថាប័នរបស់អ្នកដោយមិនចាំបាច់ទាក់ទងអ្នកឡើយ។',
      inst_type_label: 'ប្រភេទស្ថាប័ន',
      type_employer: 'និយោជក (ក្រុមហ៊ុន ឬអង្គការ)', // TODO(km-review)
      employee_section: 'បុគ្គលិក', // TODO(km-review)
      employee_email: 'អ៊ីមែលបុគ្គលិក', // TODO(km-review)
      employee_email_req: 'អ៊ីមែលបុគ្គលិក', // TODO(km-review)
      employee_found: '✓ បុគ្គលិកមានគណនី Actik', // TODO(km-review)
      issuing_employer: 'និយោជក', // TODO(km-review)
      issue_desc_employment: 'ចុះហត្ថលេខា និងផ្ញើកំណត់ត្រាការងារ។ វាចូលកាបូបបុគ្គលិក លុះត្រាតែពួកគេទទួលយក។', // TODO(km-review)
      type_employment: 'កំណត់ត្រាការងារ', // TODO(km-review)
      type_employment_desc: 'បញ្ជាក់ថានរណាម្នាក់កំពុងធ្វើ ឬធ្លាប់ធ្វើការនៅទីនេះ៖ មុខតំណែង និងកាលបរិច្ឆេទ។ បុគ្គលិកទទួលយកវាចូលកាបូបរបស់ខ្លួន។', // TODO(km-review)
      job_title_req: 'មុខតំណែង *', // TODO(km-review)
      employment_type_req: 'ប្រភេទការងារ *', // TODO(km-review)
      employment_type_full_time: 'ពេញម៉ោង', // TODO(km-review)
      employment_type_part_time: 'ក្រៅម៉ោង', // TODO(km-review)
      employment_type_contract: 'កិច្ចសន្យា', // TODO(km-review)
      employment_type_internship: 'កម្មសិក្សា', // TODO(km-review)
      employment_type_volunteer: 'ស្ម័គ្រចិត្ត', // TODO(km-review)
      employment_start_req: 'ថ្ងៃចាប់ផ្តើម *', // TODO(km-review)
      employment_end: 'ថ្ងៃបញ្ចប់', // TODO(km-review)
      still_employed: 'នៅតែធ្វើការនៅទីនេះ', // TODO(km-review)
      department_opt: 'ផ្នែក (ស្រេចចិត្ត)', // TODO(km-review)
      job_description_opt: 'តួនាទី មួយបន្ទាត់ (ស្រេចចិត្ត)', // TODO(km-review)
      employment_never: 'កំណត់ត្រាការងារមិនដែលមានប្រាក់ខែ មូលហេតុនៃការចាកចេញ ការវាយតម្លៃ ឬកំណត់ចំណាំវិន័យទេ។ នៅពេលការងារបញ្ចប់ ឬមុខតំណែងផ្លាស់ប្តូរ សូមចេញកំណត់ត្រាថ្មី ហើយដកកំណត់ត្រានេះវិញជា “ជំនួសដោយលិខិតដែលបានកែតម្រូវ”។', // TODO(km-review)
      employer_note: 'និយោជកដែលបានចុះឈ្មោះចេញកំណត់ត្រាការងារជូនបុគ្គលិករបស់ខ្លួន — មុខតំណែង និងកាលបរិច្ឆេទ — ហើយគ្មានអ្វីផ្សេងទៀតទេ។ អ្នកផ្ទៀងផ្ទាត់បង្ហាញវាជានិយោជកដែលបានចុះឈ្មោះ មិនមែនជាស្ថាប័នដែលទទួលស្គាល់ទេ។', // TODO(km-review)
      register_btn_text: 'ចុះឈ្មោះស្ថាប័ន'
    },
    role: {
      issuer: 'ស្ថាប័ន',
      student: 'សិស្ស',
      admin: 'អ្នកគ្រប់គ្រង'
    },
    settings: {
      title: 'ការកំណត់ស្ថាប័ន',
      subtitle: 'គ្រប់គ្រងប្រវត្តិរូបស្ថាប័នរបស់អ្នក',
      language: 'ជម្រើសភាសា',
      language_desc: 'ជ្រើសរើសភាសាដែលអ្នកចង់ប្រើសម្រាប់ផ្ទាំងគ្រប់គ្រង។',
      status_loading: 'កំពុងផ្ទុកការកំណត់...',
      status_failed: 'បរាជ័យក្នុងការផ្ទុកទម្រង់',
      status_error: 'មានកំហុសពេលភ្ជាប់ទៅ Supabase។',
      retry_btn: 'ព្យាយាមម្តងទៀត',
      copied: 'បានចម្លង!',
      copy_failed: 'បរាជ័យក្នុងការចម្លង។',
      accreditation_revoked: 'ការទទួលស្គាល់ត្រូវបានដកហូត',
      accreditation_revoked_on: 'ការទទួលស្គាល់ត្រូវបានដកហូតនៅថ្ងៃទី',
      accredited: 'បានទទួលស្គាល់',
      approved_by_moeys: 'បានអនុម័តដោយក្រសួងអប់រំ',
      approved_by_moeys_on: 'នៅថ្ងៃទី',
      pending_approval: 'រង់ចាំការអនុម័ត',
      awaiting_moeys_approval: 'កំពុងរង់ចាំការអនុម័តពីក្រសួងអប់រំ',
      no_inst_registered: 'មិនមានស្ថាប័នបានចុះឈ្មោះទេ',
      no_inst_desc: 'ទម្រង់ស្ថាប័នរបស់អ្នកមិនទាន់បានកំណត់រចនាសម្ព័ន្ធទេ។ ដើម្បីចុះហត្ថលេខាលើវិញ្ញាបនបត្រឌីជីថលតំណាងស្ថាប័នរបស់អ្នក អ្នកត្រូវតែបញ្ចប់ការចុះឈ្មោះសិន។',
      register_inst_btn: 'ចុះឈ្មោះស្ថាប័ន',
      inst_profile: 'ព័ត៌មានស្ថាប័ន',
      official_name: 'ឈ្មោះផ្លូវការ',
      inst_domain: 'ដែន (Domain) ស្ថាប័ន',
      inst_type: 'ប្រភេទស្ថាប័ន',
      registered_date: 'កាលបរិច្ឆេទចុះឈ្មោះ',
      updated_date: 'កាលបរិច្ឆេទធ្វើបច្ចុប្បន្នភាព',
      did_title: 'អត្តសញ្ញាណវិមជ្ឈការ (DID)',
      did_label: 'អត្តសញ្ញាណវិមជ្ឈការ (DID)',
      did_desc_label: 'អត្តសញ្ញាណវិមជ្ឈការ (DID):',
      did_desc_text: 'អត្តសញ្ញាណស្ថាប័នពិសេសរបស់អ្នកនៅលើ Actik។ វាគឺជាទម្រង់ did:web ស្តង់ដារដែលបានចងភ្ជាប់ជាមួយដែនស្ថាប័នរបស់អ្នក អនុញ្ញាតឱ្យអ្នកផ្ទៀងផ្ទាត់ទូទាំងពិភពលោកអាចដោះស្រាយសោសាធារណៈរបស់អ្នកដោយគ្រីបតូក្រាហ្វី។',
      accreditation_status: 'ស្ថានភាពទទួលស្គាល់',
      accreditation_pending_desc: 'ការចុះឈ្មោះរបស់អ្នកទទួលបានជោគជ័យ។ អ្នកគ្រប់គ្រងក្រសួងអប់រំ យុវជន និងកីឡា (MoEYS) នឹងពិនិត្យមើលការកំណត់រចនាសម្ព័ន្ធដែនវិញ្ញាបនបត្ររបស់អ្នក មុនពេលអនុម័តការទទួលស្គាល់របស់អ្នក។ អ្នកមិនអាចចេញវិញ្ញាបនបត្រទេ ខណៈពេលរង់ចាំការអនុម័ត។',
      public_key_title: 'សោសាធារណៈ (សម្រាប់ការផ្ទៀងផ្ទាត់)',
      copy_btn: 'ចម្លង',
      copied_btn: 'បានចម្លង',
      public_key_desc_label: 'សោសាធារណៈ (ES256):',
      public_key_desc_text: 'សោនេះគឺសាធារណៈ ហើយត្រូវបានប្រើដោយអ្នកផ្ទៀងផ្ទាត់ដើម្បីធ្វើឱ្យមានសុពលភាពហត្ថលេខាលើវិញ្ញាបនបត្រដែលអ្នកចេញ។ សោចុះហត្ថលេខាឯកជនដែលត្រូវគ្នាត្រូវបានទាញយកនៅក្នុងសម័យកម្មវិធីរុករករបស់អ្នក ហើយមិនដែលត្រូវបានចែករំលែក ឬរក្សាទុកក្នុងមូលដ្ឋានទិន្នន័យឡើយ។'
    },
    account: {
      title: 'កាបូបសុវត្ថិភាពរបស់អ្នករួចរាល់ហើយ',
      subtitle: 'វិញ្ញាបនបត្រឌីជីថលរបស់អ្នកត្រូវបានអ៊ិនគ្រីប (encrypted) ដោយសុវត្ថិភាពនៅក្នុងឧបករណ៍នេះ។ អ្នកអាចទទួលយក រក្សាទុក និងផ្ទៀងផ្ទាត់វិញ្ញាបនបត្ររបស់អ្នក។',
      account_info: 'ព័ត៌មានគណនី',
      email: 'អាសយដ្ឋានអ៊ីមែល',
      role: 'តួនាទីគណនី',
      created: 'បានបង្កើតគណនី',
      vault_security: 'សុវត្ថិភាពកាបូប',
      unlock_method: 'វិធីសាស្ត្របើកសោ',
      vault_configured: 'បានកំណត់រចនាសម្ព័ន្ធកាបូប',
      change_unlock: 'ផ្លាស់ប្តូរវិធីសាស្ត្របើកសោ',
      go_wallet: 'ទៅកាន់កាបូបរបស់ខ្ញុំ',
      reset_vault: 'កំណត់កាបូបឡើងវិញ',
      language: 'ជម្រើសភាសា',
      language_desc: 'ជ្រើសរើសភាសាដែលអ្នកចង់ប្រើសម្រាប់កាបូបរបស់អ្នក។',
      setup_title: 'រៀបចំកាបូបសុវត្ថិភាពរបស់អ្នក',
      checking_vault: 'កំពុងពិនិត្យមើលស្ថានភាពកាបូប...',
      pin_method: 'លេខកូដសម្ងាត់ ៦ ខ្ទង់',
      bio_method: 'ជីវមាត្រ',
      sec_recs: 'ការណែនាំសុវត្ថិភាព', // TODO(km-review)
      sec_recs_desc: 'កុំចែករំលែកកូដសម្ងាត់របស់អ្នកជាមួយអ្នកណាម្នាក់ ទោះជាអ្នកគាំទ្រ Actik ក៏ដោយ' // TODO(km-review)
    },
    // TODO(km-review): landing page copy below is a first-pass translation, not yet reviewed by a native speaker
    landing: {
      nav_signin: 'ចូលគណនី',
      hero_eyebrow: 'ភស្តុតាងកម្មសិទ្ធិឌីជីថល',
      hero_title: 'កាន់កាប់វា។ បញ្ជាក់វា។ គ្រប់ទីកន្លែង។',
      hero_subtitle: 'Actik បំប្លែងលិខិតបញ្ជាក់ពិតទៅជាភស្តុតាងឌីជីថលដែលអាចផ្ទៀងផ្ទាត់បាន — ចាប់ផ្តើមពីវិញ្ញាបនបត្រពីស្ថាប័នដែលបានទទួលស្គាល់ គ្រីបនៅក្នុងកាបូបដែលមានតែអ្នកគ្រប់គ្រង។',
      hero_cta: 'ចូលគណនីដើម្បីចាប់ផ្តើម',
      hero_cta_sub: 'ឥតគិតថ្លៃសម្រាប់សិស្ស។ ស្ថាប័នដាក់ពាក្យសុំការទទួលស្គាល់។',
      trust_badge: 'បានចុះហត្ថលេខាតាមក្រាហ្វិក · អាចផ្ទៀងផ្ទាត់ដោយឯករាជ្យ',
      how_title: 'របៀបដំណើរការ',
      how_step1_title: 'ស្ថាប័នដែលបានទទួលស្គាល់ចេញឱ្យ',
      how_step1_desc: 'សាកលវិទ្យាល័យ និងអ្នកផ្តល់វគ្គបណ្តុះបណ្តាលដែលបានអនុម័តដោយអ្នកគ្រប់គ្រង ចេញលិខិតបញ្ជាក់ឌីជីថលដែលបានចុះហត្ថលេខាដោយផ្ទាល់ទៅអ្នក។',
      how_step2_title: 'អ្នកកាន់កាប់វា ដោយបានគ្រីប',
      how_step2_desc: 'លិខិតបញ្ជាក់របស់អ្នកនៅក្នុងកាបូបដែលមានតែអ្នកអាចបើកបាន — ដោយប្រើលេខកូដសម្ងាត់ ឬជីវមាត្រ។ Actik មិនដែលឃើញកូនសោរបស់អ្នកឡើយ។',
      how_step3_title: 'អ្នកណាក៏អាចផ្ទៀងផ្ទាត់បានភ្លាមៗ',
      how_step3_desc: 'ចែករំលែកតំណភ្ជាប់ ឬកូដ QR។ អ្នកផ្ទៀងផ្ទាត់ត្រួតពិនិត្យហត្ថលេខាក្នុងរយៈពេលប៉ុន្មានវិនាទី — មិនចាំបាច់ទូរស័ព្ទ ឬរង់ចាំឡើយ។',
      trust_title: 'បង្កើតឡើងដើម្បីទុកចិត្តបាន មិនមែនគ្រាន់តែជឿ',
      trust_1_title: 'បានចុះហត្ថលេខា មិនមែនស្កេន',
      trust_1_desc: 'លិខិតបញ្ជាក់នីមួយៗមានហត្ថលេខាតាមក្រាហ្វិកភ្ជាប់ជាមួយស្ថាប័នចេញ — រកឃើញការកែប្រែបានភ្លាមតាមរចនាសម្ព័ន្ធ។',
      trust_2_title: 'ការទទួលស្គាល់ដែលផ្ទៀងផ្ទាត់ផ្ទាល់',
      trust_2_desc: 'ស្ថាប័នត្រូវបានត្រួតពិនិត្យ និងអនុម័តមុននឹងអាចចេញបាន។ ការផ្ទៀងផ្ទាត់ត្រួតពិនិត្យស្ថានភាពរបស់ពួកគេតាមពេលវេលាជាក់ស្តែង។',
      trust_3_title: 'អ្នកគ្រប់គ្រងកូនសោរ',
      trust_3_desc: 'កាបូបរបស់អ្នកត្រូវបានគ្រីបនៅលើឧបករណ៍ផ្ទាល់ខ្លួនរបស់អ្នក។ Actik រក្សាទុកតែទិន្នន័យដែលបានគ្រីប មិនមែនទិន្នន័យរបស់អ្នកទេ។',
      for_title: 'បង្កើតឡើងសម្រាប់កម្ពុជា ចាប់ផ្តើមពីការអប់រំ',
      for_desc: 'Actik ចាប់ផ្តើមជាមួយវិញ្ញាបនបត្រសិក្សា ព្រោះតម្រូវការច្បាស់លាស់បំផុត — គ្រឹះនៃភស្តុតាងកម្មសិទ្ធិដូចគ្នាត្រូវបានរចនាឡើងឱ្យពង្រីកទៅកាន់ទ្រព្យសម្បត្តិណាមួយដែលសមនឹងផ្ទៀងផ្ទាត់។',
      for_students_title: 'សិស្ស និងបញ្ចប់ការសិក្សា',
      for_students_desc: 'ប្រមូលលិខិតបញ្ជាក់របស់អ្នកនៅកន្លែងតែមួយ ហើយចែករំលែកភ្លាមៗនៅពេលដាក់ពាក្យសុំការងារ ឬការសិក្សាបន្ថែម។',
      for_institutions_title: 'ស្ថាប័ន',
      for_institutions_desc: 'ចេញវិញ្ញាបនបត្រដែលអាចផ្ទៀងផ្ទាត់បាន នៅពេលទទួលបានការទទួលស្គាល់ពីអ្នកគ្រប់គ្រង — លែងត្រូវការលិខិតបញ្ជាក់ដោយដៃទៀតហើយ។',
      for_employers_title: 'និយោជក', // TODO(km-review)
      for_employers_desc: 'ផ្ទៀងផ្ទាត់វិញ្ញាបនបត្រក្នុងរយៈពេលប៉ុន្មានវិនាទី មិនចាំបាច់មានគណនី — គ្រាន់តែបើកតំណ។', // TODO(km-review)
      final_cta_title: 'ត្រៀមចាប់ផ្តើមហើយឬនៅ?',
      final_cta_desc: 'ចូលគណនីជាមួយ Google — ចំណាយពេលតិចជាងមួយនាទី។',
      final_cta_button: 'ចូលគណនី',
      footer_rights: '© 2026 Actik។ រក្សាសិទ្ធិគ្រប់យ៉ាង។'
    },
    proof: {
      page_title: 'សំណើភស្តុតាង', // TODO(km-review)
      page_intro: 'ស្នើសុំភស្តុតាងនៃគុណវុឌ្ឍិ ឬឆ្លើយតបសំណើពីកាបូបរបស់អ្នក។ ចម្លើយមានតែអ្វីដែលសំណើអាចមើលបាន ហើយត្រូវបានពិនិត្យជាមួយស្ថាប័នដែលបានចេញ។', // TODO(km-review)
      your_requests: 'សំណើដែលអ្នកបានបង្កើត', // TODO(km-review)
      new_request: 'សំណើថ្មី', // TODO(km-review)
      no_requests: 'អ្នកមិនទាន់បានបង្កើតសំណើទេ។', // TODO(km-review)
      your_answers: 'សំណើដែលអ្នកបានឆ្លើយ', // TODO(km-review)
      no_answers: 'អ្នកមិនទាន់បានឆ្លើយសំណើទេ។', // TODO(km-review)
      answers_count: 'ចម្លើយ {count}', // TODO(km-review)
      until: 'បើករហូតដល់ {date}', // TODO(km-review)
      sent_items: 'បានផ្ញើលិខិត {count}', // TODO(km-review)
      withdraw_answer: 'ដកវិញ', // TODO(km-review)
      withdraw_confirm: 'ដកចម្លើយរបស់អ្នកវិញ? អ្នកស្នើសុំនឹងមិនឃើញវាទៀតទេ។', // TODO(km-review)
      status_open: 'បើក', // TODO(km-review)
      status_closed: 'បានបិទ', // TODO(km-review)
      status_expired: 'ផុតកំណត់', // TODO(km-review)
      status_closed_long: 'សំណើនេះត្រូវបានបិទ ហើយលែងទទួលចម្លើយទៀតហើយ។', // TODO(km-review)
      status_expired_long: 'សំណើនេះផុតកំណត់ ហើយលែងទទួលចម្លើយទៀតហើយ។', // TODO(km-review)
      new_intro: 'បញ្ជាក់អ្វីដែលអ្នកត្រូវការមើល។ បេក្ខជនឆ្លើយពីកាបូបផ្ទាល់ខ្លួន ហើយតែជាមួយលិខិតដែលស្ថាប័នបានចេញប៉ុណ្ណោះ។', // TODO(km-review)
      requester_name: 'អ្នកណាជាអ្នកស្នើសុំ', // TODO(km-review)
      requester_name_hint: 'ស្ថាប័នរបស់អ្នក ដូចដែលបេក្ខជននឹងឃើញ។ Actik បង្ហាញវាតាមការប្រកាសរបស់អ្នក មិនបានផ្ទៀងផ្ទាត់ទេ។', // TODO(km-review)
      request_title: 'សម្រាប់អ្វី', // TODO(km-review)
      request_title_placeholder: 'ឧ. គណនេយ្យករកម្រិតដំបូង ការិយាល័យភ្នំពេញ', // TODO(km-review)
      description: 'ព័ត៌មានលម្អិត (ស្រេចចិត្ត)', // TODO(km-review)
      what_you_ask: 'អ្វីដែលអ្នកស្នើសុំ', // TODO(km-review)
      credential_type: 'ប្រភេទលិខិត', // TODO(km-review)
      remove: 'លុប', // TODO(km-review)
      also_ask: 'ស្នើមើលបន្ថែម៖', // TODO(km-review)
      note: 'កំណត់ចំណាំ', // TODO(km-review)
      note_placeholder: 'កំណត់ចំណាំរបស់អ្នក ឧ. “ផ្នែកគណនេយ្យ ឬហិរញ្ញវត្ថុ” (ស្រេចចិត្ត)', // TODO(km-review)
      add_requirement: 'ស្នើលិខិតមួយទៀត', // TODO(km-review)
      always_shown: 'ចម្លើយនីមួយៗបង្ហាញឈ្មោះម្ចាស់ ស្ថាប័នចេញ លិខិតខ្លួនឯង លេខឯកសារ និងកាលបរិច្ឆេទ — ដើម្បីឱ្យអ្នកពិនិត្យអត្តសញ្ញាណប័ណ្ណនៅពេលសម្ភាសន៍។', // TODO(km-review)
      never_asked: 'សំណើមិនអាចស្នើសុំថ្ងៃខែឆ្នាំកំណើត ឬអាយុ ភេទ ស្ថានភាពគ្រួសារ រូបថត អត្តសញ្ញាណប័ណ្ណ លេខសិស្ស ទីកន្លែងកំណើត សាសនា ឬជាតិពន្ធុ ឬអ៊ីមែល ឬលេខទូរស័ព្ទបានទេ។', // TODO(km-review)
      open_for: 'បើករយៈពេល', // TODO(km-review)
      days: '{count} ថ្ងៃ', // TODO(km-review)
      saving: 'កំពុងរក្សាទុក…', // TODO(km-review)
      create: 'បង្កើតសំណើ', // TODO(km-review)
      invalid_REQUESTER_NAME: 'សូមបញ្ជាក់អ្នកស្នើសុំ (២–១២០ តួអក្សរ)។', // TODO(km-review)
      invalid_TITLE: 'សូមដាក់ចំណងជើង (២–១២០ តួអក្សរ)។', // TODO(km-review)
      invalid_DESCRIPTION: 'ព័ត៌មានលម្អិតវែងពេក។', // TODO(km-review)
      invalid_NO_REQUIREMENTS: 'សូមស្នើយ៉ាងហោចណាស់លិខិតមួយ។', // TODO(km-review)
      invalid_TOO_MANY_REQUIREMENTS: 'អាចស្នើបានច្រើនបំផុតប្រាំលិខិត។', // TODO(km-review)
      invalid_UNKNOWN_TYPE: 'មិនអាចស្នើប្រភេទលិខិតនោះបានទេ។', // TODO(km-review)
      invalid_FIELD_NOT_REQUESTABLE: 'មិនអាចស្នើព័ត៌មាននោះបានទេ។', // TODO(km-review)
      invalid_NOTE: 'កំណត់ចំណាំវែងពេក។', // TODO(km-review)
      invalid_EXPIRY: 'សំណើបើកពី ១ ដល់ ៩០ ថ្ងៃ។', // TODO(km-review)
      not_found: 'គ្មានសំណើនេះទេ។', // TODO(km-review)
      share_heading: 'ចែករំលែកសំណើនេះ', // TODO(km-review)
      share_hint: 'ផ្ញើតំណ ឬបង្ហាញកូដ។ អ្នកមានវាអាចឃើញអ្វីដែលអ្នកស្នើ ប៉ុន្តែតែអ្នកដែលឆ្លើយទេដែលផ្ញើអ្វីមកអ្នក។', // TODO(km-review)
      close_request: 'បិទសំណើ', // TODO(km-review)
      close_confirm: 'បិទសំណើនេះ? គ្មាននរណាអាចឆ្លើយវាបានទៀតទេ។', // TODO(km-review)
      answers_heading: 'ចម្លើយ ({count})', // TODO(km-review)
      answers_hint: 'ចម្លើយនីមួយៗត្រូវបានពិនិត្យលើឧបករណ៍នេះ ជាមួយបញ្ជីទុកចិត្តដែលបានចុះហត្ថលេខា និងបញ្ជីដកហូតរបស់ស្ថាប័ន។', // TODO(km-review)
      no_answers_yet: 'មិនទាន់មានចម្លើយទេ។', // TODO(km-review)
      contact: 'ទំនាក់ទំនង៖', // TODO(km-review)
      not_answered: 'មិនបានឆ្លើយ។', // TODO(km-review)
      not_asked_WRONG_TYPE: 'មិនរាប់បញ្ចូល៖ នេះជាប្រភេទលិខិតខុសពីអ្វីដែលបានស្នើ។', // TODO(km-review)
      not_asked_OVER_DISCLOSED: 'មិនបង្ហាញ៖ ចម្លើយនេះមានព័ត៌មានដែលសំណើមិនអាចស្នើបាន។', // TODO(km-review)
      not_asked_NO_SUCH_REQUIREMENT: 'មិនបង្ហាញ។', // TODO(km-review)
      could_not_check: 'មិនអាចពិនិត្យបាននៅពេលនេះ', // TODO(km-review)
      did_not_verify: 'មិនបានផ្ទៀងផ្ទាត់', // TODO(km-review)
      issued_by: 'ចេញដោយ', // TODO(km-review)
      check_id: 'ចេញជូន {name}។ សូមពិនិត្យអត្តសញ្ញាណប័ណ្ណនៅពេលសម្ភាសន៍៖ លិខិតបញ្ជាក់ថាចេញជូននរណា មិនមែនថានរណាកំពុងបង្ហាញវាទេ។', // TODO(km-review)
      request_from: 'សំណើភស្តុតាង', // TODO(km-review)
      requester_unverified: 'តាមការពិពណ៌នារបស់អ្នកស្នើសុំ។ Actik មិនបានផ្ទៀងផ្ទាត់ថាពួកគេជានរណាទេ។', // TODO(km-review)
      they_ask: 'ពួកគេស្នើសុំ', // TODO(km-review)
      answer_shows: 'ចម្លើយបង្ហាញឈ្មោះរបស់អ្នក ស្ថាប័នចេញ លិខិត លេខឯកសារ និងកាលបរិច្ឆេទ និងព័ត៌មានបន្ថែមដែលបានរាយខាងលើ — គ្មានអ្វីផ្សេងទៀតទេ។', // TODO(km-review)
      answer_from_wallet: 'ឆ្លើយពីកាបូប Actik របស់ខ្ញុំ', // TODO(km-review)
      answer_privacy: 'មានតែអ្នកស្នើសុំទេដែលឃើញចម្លើយរបស់អ្នក។ អ្នកអាចដកវាវិញនៅពេលណាក៏បានពីសំណើភស្តុតាង។', // TODO(km-review)
      no_wallet: 'អ្នកត្រូវការកាបូប Actik ដែលមានលិខិតដើម្បីឆ្លើយ។', // TODO(km-review)
      set_up_wallet: 'រៀបចំកាបូបរបស់អ្នក', // TODO(km-review)
      unlock_failed: 'កាបូបមិនបានដោះសោទេ។ សូមព្យាយាមម្តងទៀត។', // TODO(km-review)
      no_match: 'កាបូបរបស់អ្នកគ្មានលិខិតប្រភេទនេះទេ។', // TODO(km-review)
      checking: 'កំពុងពិនិត្យ…', // TODO(km-review)
      skip_requirement: 'មិនឆ្លើយចំណុចនេះ', // TODO(km-review)
      they_will_see: '{requester} នឹងឃើញ៖', // TODO(km-review)
      contact_label: 'របៀបទាក់ទងអ្នក', // TODO(km-review)
      contact_hint: 'បង្ហាញដល់អ្នកស្នើសុំជាមួយចម្លើយរបស់អ្នក។ អ៊ីមែលគណនីរបស់អ្នកមិនត្រូវបានចែករំលែកទេ លុះត្រាតែអ្នកទុកវានៅទីនេះ។', // TODO(km-review)
      sending: 'កំពុងផ្ញើ…', // TODO(km-review)
      send_answer: 'ផ្ញើលិខិត {count}', // TODO(km-review)
      already_answered: 'អ្នកបានឆ្លើយសំណើនេះរួចហើយ។ សូមដកចម្លើយនោះវិញជាមុនសិន ដើម្បីផ្ញើចម្លើយថ្មី។', // TODO(km-review)
      sent_title: 'បានផ្ញើចម្លើយ។', // TODO(km-review)
      sent_desc: '{requester} អាចឃើញអ្វីដែលអ្នកបានផ្ញើ។ អ្នកអាចដកវាវិញពីសំណើភស្តុតាង។', // TODO(km-review)
      type_academic_degree: 'សញ្ញាបត្រសិក្សា', // TODO(km-review)
      type_professional_certification: 'វិញ្ញាបនបត្រវិជ្ជាជីវៈ', // TODO(km-review)
      type_completion: 'វិញ្ញាបនបត្របញ្ចប់', // TODO(km-review)
      type_attendance_participation: 'ការចូលរួម', // TODO(km-review)
      type_merit_excellence: 'រង្វាន់កិត្តិយស ឬឧត្តមភាព', // TODO(km-review)
      type_appreciation_service: 'ការកោតសរសើរ ឬសេវាកម្ម', // TODO(km-review)
      field_institution: 'ស្ថាប័ន', // TODO(km-review)
      field_name: 'ឈ្មោះ', // TODO(km-review)
      field_degree_type: 'សញ្ញាបត្រ', // TODO(km-review)
      field_degree: 'សញ្ញាបត្រ', // TODO(km-review)
      field_graduation_date: 'ថ្ងៃបញ្ចប់ការសិក្សា', // TODO(km-review)
      field_certificate_id: 'លេខវិញ្ញាបនបត្រ', // TODO(km-review)
      field_sub_type: 'ប្រភេទ', // TODO(km-review)
      field_event_name: 'ព្រឹត្តិការណ៍', // TODO(km-review)
      field_event_date: 'ថ្ងៃព្រឹត្តិការណ៍', // TODO(km-review)
      field_organizer: 'អ្នករៀបចំ', // TODO(km-review)
      field_program_name: 'កម្មវិធី', // TODO(km-review)
      field_completion_date: 'ថ្ងៃបញ្ចប់', // TODO(km-review)
      field_achievement_title: 'សមិទ្ធផល', // TODO(km-review)
      field_date_awarded: 'ថ្ងៃប្រគល់', // TODO(km-review)
      field_reason: 'មូលហេតុ', // TODO(km-review)
      field_date: 'កាលបរិច្ឆេទ', // TODO(km-review)
      field_cert_name: 'វិញ្ញាបនបត្រ', // TODO(km-review)
      field_issuing_body: 'ស្ថាប័នចេញ', // TODO(km-review)
      field_date_certified: 'ថ្ងៃទទួលស្គាល់', // TODO(km-review)
      field_license_number: 'លេខអាជ្ញាប័ណ្ណ', // TODO(km-review)
      field_expiry_date: 'ថ្ងៃផុតកំណត់', // TODO(km-review)
      field_major: 'ជំនាញ', // TODO(km-review)
      field_gpa: 'មធ្យមភាគពិន្ទុ', // TODO(km-review)
      field_duration: 'រយៈពេល', // TODO(km-review)
      field_department_or_role: 'ផ្នែក ឬតួនាទី', // TODO(km-review)
      field_role_description: 'តួនាទី', // TODO(km-review)
      field_basis_description: 'មូលដ្ឋាននៃរង្វាន់', // TODO(km-review)
      field_capacity: 'សមត្ថភាព', // TODO(km-review)
      type_employment_record: 'កំណត់ត្រាការងារ', // TODO(km-review)
      kind_institution: 'ស្ថាប័នដែលទទួលស្គាល់', // TODO(km-review)
      kind_employer: 'និយោជកដែលបានចុះឈ្មោះ', // TODO(km-review)
      field_job_title: 'មុខតំណែង', // TODO(km-review)
      field_employment_type: 'ប្រភេទការងារ', // TODO(km-review)
      field_employment_start: 'ចាប់ផ្តើម', // TODO(km-review)
      field_employment_end: 'បញ្ចប់', // TODO(km-review)
      field_employment_status: 'ស្ថានភាព', // TODO(km-review)
      field_department: 'ផ្នែក', // TODO(km-review)
      employment_current_as_of: 'នៅធ្វើការ គិតត្រឹម {date} (ពេលនិយោជកចុះហត្ថលេខា)', // TODO(km-review)
      employment_ended: 'បានបញ្ចប់', // TODO(km-review)
      employment_type_full_time: 'ពេញម៉ោង', // TODO(km-review)
      employment_type_part_time: 'ក្រៅម៉ោង', // TODO(km-review)
      employment_type_contract: 'កិច្ចសន្យា', // TODO(km-review)
      employment_type_internship: 'កម្មសិក្សា', // TODO(km-review)
      employment_type_volunteer: 'ស្ម័គ្រចិត្ត', // TODO(km-review)
    },
    museum: {
      title: 'បន្ថែមទៅសារមន្ទីរ CamboVerse', // TODO(km-review)
      intro: 'អ្នកជាអ្នកសម្រេចថាអ្វីអាចបង្ហាញបាន។ ឯកសារដើមនៅតែក្នុងកាបូបរបស់អ្នក — វត្ថុតាំងពិព័រណ៍មានតែស្នាមម្រាមដៃរបស់វា រូបភាពដែលអ្នករៀបចំនៅទីនេះ និងកូដដែលស្ថាប័នបានចុះហត្ថលេខា ប្រសិនបើអ្នកជ្រើសរើស។', // TODO(km-review)
      image_heading: 'អ្វីដែលរូបភាពបង្ហាញ', // TODO(km-review)
      mode_cover: 'បិទបាំង', // TODO(km-review)
      mode_crop: 'កាត់', // TODO(km-review)
      cover_hint: 'អូសលើអ្វីដែលអ្នកមិនចង់បង្ហាញ — ថ្ងៃខែឆ្នាំ ឬទីកន្លែងកំណើត លេខអត្តសញ្ញាណ ឬលេខសិស្ស រូបថត ហត្ថលេខា។', // TODO(km-review)
      crop_hint: 'អូសដើម្បីជ្រើសផ្នែកនៃវិញ្ញាបនបត្រដែលត្រូវបង្ហាញ។', // TODO(km-review)
      undo: 'មិនធ្វើវិញ', // TODO(km-review)
      reset: 'ចាប់ផ្តើមម្តងទៀត', // TODO(km-review)
      no_image: 'កុំបង្ហាញរូបភាព — បង្ហាញតែចំណងជើង និងស្ថាប័ន', // TODO(km-review)
      pdf_no_image: 'វិញ្ញាបនបត្រនេះជា PDF ដូច្នេះគ្មានរូបភាពភ្ជាប់ទេ វាបង្ហាញចំណងជើង និងស្ថាប័ន។', // TODO(km-review)
      no_file: 'លិខិតនេះគ្មានឯកសារ ដូច្នេះវាបង្ហាញចំណងជើង និងស្ថាប័ន។', // TODO(km-review)
      sensitive_heading: 'លិខិតនេះមាន៖', // TODO(km-review)
      sensitive_hint: 'ទាំងនេះប្រហែលជាបានបោះពុម្ពលើវិញ្ញាបនបត្រ។ សូមបិទបាំងវាមុនពេលបង្ហាញ។', // TODO(km-review)
      general_warning: 'វិញ្ញាបនបត្រច្រើនតែបង្ហាញឈ្មោះពេញ ថ្ងៃខែឆ្នាំ និងទីកន្លែងកំណើត លេខអត្តសញ្ញាណ ឬលេខសិស្ស និងរូបថត។ រូបភាពត្រូវបានបង្រួម និងរក្សាទុកឡើងវិញ ដែលលុបទិន្នន័យលាក់ ដូចជាទីតាំង។', // TODO(km-review)
      visibility_heading: 'អ្នកណាអាចមើលឃើញ', // TODO(km-review)
      vis_private: 'តែខ្ញុំ', // TODO(km-review)
      vis_private_hint: 'វាព្យួរក្នុងបន្ទប់របស់អ្នក ហើយមិនបង្ហាញអ្នកដទៃ។', // TODO(km-review)
      vis_link: 'អ្នកដែលខ្ញុំផ្ញើតំណ', // TODO(km-review)
      vis_link_hint: 'បង្ហាញតែអ្នកដែលមានតំណបន្ទប់របស់អ្នក។', // TODO(km-review)
      vis_public: 'គ្រប់គ្នា', // TODO(km-review)
      vis_public_hint: 'អ្នកណាក៏ដោយដែលរកឃើញបន្ទប់របស់អ្នក។', // TODO(km-review)
      vis_note: 'នេះជាកម្រិតខ្ពស់បំផុតដែលសារមន្ទីរអាចបង្ហាញ។ ប្រសិនបើបន្ទប់របស់អ្នកកំណត់តឹងជាង បន្ទប់ឈ្នះ។', // TODO(km-review)
      public_confirm: 'ខ្ញុំបានពិនិត្យរូបភាព ហើយវាមិនបង្ហាញអ្វីដែលខ្ញុំមិនចង់ឱ្យសាធារណៈឃើញទេ។', // TODO(km-review)
      printed_heading: 'កូដដែលស្ថាប័នបានចុះហត្ថលេខា', // TODO(km-review)
      printed_include: 'ដាក់បញ្ចូល', // TODO(km-review)
      printed_hint: 'អនុញ្ញាតឱ្យសារមន្ទីរបង្ហាញថាអ្នកណាជាអ្នកចេញ ដោយពិនិត្យលើឧបករណ៍របស់អ្នកមើលផ្ទាល់។ អ្នកដែលមើលឃើញវត្ថុតាំងអាចអានអ្វីដែលកូដចុះហត្ថលេខា៖ ឈ្មោះ លេខឯកសារ ស្ថាប័ន និងកាលបរិច្ឆេទ។', // TODO(km-review)
      printed_none: 'លិខិតនេះគ្មានកូដបោះពុម្ព ដូច្នេះសារមន្ទីរនឹងបង្ហាញថាអ្នកជាអ្នកបន្ថែម។', // TODO(km-review)
      preview: 'មើលរូបភាពជាមុន', // TODO(km-review)
      preview_heading: 'អ្វីដែលអាចបង្ហាញបានពិតប្រាកដ', // TODO(km-review)
      prepare: 'រៀបចំឯកសារវត្ថុតាំង', // TODO(km-review)
      preparing: 'កំពុងរៀបចំ…', // TODO(km-review)
      download: 'ទាញយកឯកសារវត្ថុតាំង', // TODO(km-review)
      copy: 'ចម្លង', // TODO(km-review)
      copied: 'បានចម្លង', // TODO(km-review)
      done: 'ឯកសារវត្ថុតាំងរួចរាល់។ បន្ថែមវាទៅបន្ទប់របស់អ្នកក្នុង CamboVerse។ វានឹងបង្ហាញថាអ្នកជាអ្នកបន្ថែម — នោះជារឿងធម្មតា មិនមែនជាការព្រមានទេ។', // TODO(km-review)
      refused_withdrawn: 'ស្ថាប័នបានដកហូតលិខិតនេះ ដូច្នេះមិនអាចបន្ថែមទៅសារមន្ទីរបានទេ។', // TODO(km-review)
      refused_rejected: 'លិខិតនេះមិនបានផ្ទៀងផ្ទាត់ ដូច្នេះមិនអាចបន្ថែមទៅសារមន្ទីរបានទេ។', // TODO(km-review)
      close: 'បិទ', // TODO(km-review)
      export_button: 'បន្ថែមទៅសារមន្ទីរ', // TODO(km-review)
    },
    print: {
      title: 'វិញ្ញាបនបត្រសម្រាប់បោះពុម្ព', // TODO(km-review)
      toolbar_hint: 'បោះពុម្ពលើក្រដាស A4 ផ្តេក។ ប្រើ “Save as PDF” ក្នុងប្រអប់បោះពុម្ព ដើម្បីរក្សាទុកជាឯកសារ។', // TODO(km-review)
      print_button: 'បោះពុម្ព', // TODO(km-review)
      reprint: 'បោះពុម្ពវិញ្ញាបនបត្រ', // TODO(km-review)
      certifies: 'សូមបញ្ជាក់ថា', // TODO(km-review)
      has_been_awarded: 'ត្រូវបានប្រគល់', // TODO(km-review)
      signed_fields: 'បានចុះហត្ថលេខាក្នុងកូដ — អេក្រង់អ្នកផ្ទៀងផ្ទាត់ត្រូវបង្ហាញដូចនេះទាំងស្រុង', // TODO(km-review)
      field_holder: 'ម្ចាស់', // TODO(km-review)
      field_document_id: 'លេខឯកសារ', // TODO(km-review)
      field_institution: 'ស្ថាប័នចេញ', // TODO(km-review)
      field_issue_date: 'កាលបរិច្ឆេទចេញ', // TODO(km-review)
      scan_caption: 'ផ្ទៀងផ្ទាត់ដោយកម្មវិធី Actik។', // TODO(km-review)
      no_website: 'កូដនេះមិនបើកគេហទំព័រទេ។ ប្រសិនបើកម្មវិធីស្កេនស្នើឱ្យបើកគេហទំព័រ នេះមិនមែនជាវិញ្ញាបនបត្រពិតទេ។', // TODO(km-review)
      offer_title: 'វិញ្ញាបនបត្របោះពុម្ព', // TODO(km-review)
      offer_desc: 'ច្បាប់ចម្លងដែលកូដ QR ផ្ទុកវិញ្ញាបនបត្រដែលបានចុះហត្ថលេខាផ្ទាល់ — ផ្ទៀងផ្ទាត់ក្នុងកម្មវិធី Actik ដោយមិនពាក់ព័ន្ធនឹងគេហទំព័រ។', // TODO(km-review)
      offer_button: 'បើកវិញ្ញាបនបត្រសម្រាប់បោះពុម្ព', // TODO(km-review)
      unavailable_no_number: 'មិនមានសម្រាប់វិញ្ញាបនបត្រនេះទេ៖ វិញ្ញាបនបត្របោះពុម្ពត្រូវការលេខឯកសារ ដើម្បីឱ្យអ្នកផ្ទៀងផ្ទាត់ប្រៀបធៀបជាមួយក្រដាស។', // TODO(km-review)
      unavailable_error: 'មិនអាចរៀបចំវិញ្ញាបនបត្រសម្រាប់បោះពុម្ពបានទេ៖', // TODO(km-review)
    },
    scan: {
      tagline: 'ផ្ទៀងផ្ទាត់វិញ្ញាបនបត្របោះពុម្ព', // TODO(km-review)
      title: 'ផ្ទៀងផ្ទាត់វិញ្ញាបនបត្របោះពុម្ព', // TODO(km-review)
      intro: 'ស្កេនកូដ QR លើវិញ្ញាបនបត្រ Actik។ វាត្រូវបានពិនិត្យនៅទីនេះ ក្នុងកម្មវិធីនេះ — វិញ្ញាបនបត្រពិតមិនដែលនាំអ្នកទៅគេហទំព័រទេ។', // TODO(km-review)
      mode_camera: 'កាមេរ៉ា', // TODO(km-review)
      mode_photo: 'រូបថត', // TODO(km-review)
      mode_paste: 'បិទភ្ជាប់', // TODO(km-review)
      start_camera: 'បើកកាមេរ៉ា', // TODO(km-review)
      camera_error: 'មិនអាចបើកកាមេរ៉ាបានទេ។ សូមអនុញ្ញាតកាមេរ៉ា ឬប្រើរូបថតកូដជំនួស។', // TODO(km-review)
      choose_photo: 'ជ្រើសរើសរូបថតកូដ QR', // TODO(km-review)
      photo_hint: 'រូបថតច្បាស់ និងត្រង់នៃកូដលើក្រដាស។', // TODO(km-review)
      no_code_found: 'មិនអាចអានកូដ QR ពីរូបភាពនោះបានទេ។ សូមថតឱ្យជិត និងច្បាស់ជាងនេះ។', // TODO(km-review)
      verify_button: 'ផ្ទៀងផ្ទាត់', // TODO(km-review)
      checking: 'កំពុងពិនិត្យ…', // TODO(km-review)
      scan_another: 'ស្កេនមួយទៀត', // TODO(km-review)
      url_title: 'កូដនេះបើកគេហទំព័រ', // TODO(km-review)
      other_title: 'មិនមែនជាកូដវិញ្ញាបនបត្រ Actik ទេ', // TODO(km-review)
      other_desc: 'កម្មវិធីនេះរកមិនឃើញវិញ្ញាបនបត្រ Actik ក្នុងកូដនេះទេ។ នោះមិនមែនមានន័យថាវាក្លែងក្លាយទេ — គ្រាន់តែមិនមែនជាអ្វីដែលកម្មវិធីនេះពិនិត្យ។', // TODO(km-review)
      rejected_title: 'វិញ្ញាបនបត្រនេះផ្ទៀងផ្ទាត់មិនបាន', // TODO(km-review)
      do_not_accept: 'កុំទទួលយកវិញ្ញាបនបត្រនេះជាភស្តុតាង។', // TODO(km-review)
      signed_by: 'សោដែលបញ្ជីទុកចិត្តដែលបានចុះហត្ថលេខាបញ្ជាក់ថាជារបស់ {issuer} បានចុះហត្ថលេខាលើព័ត៌មានខាងក្រោម។ នោះជាអ្វីដែលបានពិនិត្យ។', // TODO(km-review)
      retired_key_note: '(វាត្រូវបានចុះហត្ថលេខាដោយសោដែលស្ថាប័នបានឈប់ប្រើ មុនពេលឈប់ប្រើ។)', // TODO(km-review)
      compare_desc: 'ប្រៀបធៀបនីមួយៗជាមួយក្រដាសនៅចំពោះមុខអ្នក។ កូដពិតដែលចម្លងទៅលើវិញ្ញាបនបត្រក្លែងក្លាយនៅតែផ្ទៀងផ្ទាត់បាន — ការប្រៀបធៀបនេះទើបចាប់បាន។', // TODO(km-review)
      type_to_compare: 'វាយអ្វីដែលក្រដាសសរសេរ ដើម្បីប្រៀបធៀបឱ្យជាក់លាក់', // TODO(km-review)
      matches_typed: 'ត្រូវនឹងអ្វីដែលអ្នកវាយ', // TODO(km-review)
      differs_typed: 'ខុសគ្នា — អ្នកបានវាយ “{value}”', // TODO(km-review)
      mismatch_warning: 'មាន {count} ចំណុចខុសពីក្រដាស។ កុំទទួលយកវិញ្ញាបនបត្រនេះ។', // TODO(km-review)
      trust_list_version: 'បញ្ជីទុកចិត្តដែលបានចុះហត្ថលេខា v{version}', // TODO(km-review)
    },
    verify: {
      tagline: 'ភស្តុតាងនៃកម្មសិទ្ធិ', // TODO(km-review)
      result_label: 'លទ្ធផលការផ្ទៀងផ្ទាត់',
      invalid_link_title: 'តំណផ្ទៀងផ្ទាត់មិនត្រឹមត្រូវ', // TODO(km-review)
      invalid_link_desc: 'នេះមិនមែនជាតំណផ្ទៀងផ្ទាត់ Actik ត្រឹមត្រូវទេ', // TODO(km-review)
      invalid_link_hint: 'សូមពិនិត្យមើលថាអ្នកមាន URL ពេញលេញ', // TODO(km-review)
      loading_title: 'កំពុងផ្ទៀងផ្ទាត់វិញ្ញាបនបត្រ…',
      no_account_needed: 'no account needed · nothing is stored about you',
      check_1: 'ទាញយកវិញ្ញាបនបត្រ…', // TODO(km-review)
      check_2: 'ពិនិត្យសុពលភាពតំណ…',
      check_3: 'ផ្ទៀងផ្ទាត់ហត្ថលេខាស្ថាប័ន…',
      check_4: 'ពិនិត្យបញ្ជីស្ថាប័នទុកចិត្តដែលបានចុះហត្ថលេខា…', // TODO(km-review)
      check_5: 'ពិនិត្យថាតើស្ថាប័នបានដកហូតវាឬទេ…', // TODO(km-review)
      withdrawn_title: 'ត្រូវបានដកហូតដោយស្ថាប័នចេញ', // TODO(km-review)
      withdrawn_withdrawn: 'ស្ថាប័នដែលបានចេញវា បានដកហូតវាវិញ។', // TODO(km-review)
      withdrawn_corrected: 'ស្ថាប័នបានជំនួសវាដោយលិខិតបញ្ជាក់ដែលបានកែតម្រូវ។ សូមស្នើសុំលិខិតដែលបានកែតម្រូវពីម្ចាស់។', // TODO(km-review)
      standing_clear_title: 'មិនត្រូវបានដកហូតទេ។', // TODO(km-review)
      standing_clear_desc: 'បានពិនិត្យជាមួយបញ្ជីដកហូតរបស់ {issuer} កំណែ {version} ចុះថ្ងៃ {date}។ ការដកហូតដែលធ្វើក្រោយថ្ងៃនោះនឹងមិនបង្ហាញនៅទីនេះទេ។', // TODO(km-review)
      standing_unchecked_title: 'ហត្ថលេខាត្រឹមត្រូវ តែស្ថានភាពមិនទាន់បានពិនិត្យ។', // TODO(km-review)
      standing_none_desc: '{issuer} មិនបោះពុម្ពផ្សាយបញ្ជីដកហូតទេ ដូច្នេះមិនដឹងថាតើវាបានដកហូតវិញ្ញាបនបត្រនេះហើយឬនៅទេ។ កុំចាត់ទុកថានៅមានសុពលភាពដោយផ្អែកលើទំព័រនេះតែមួយ។', // TODO(km-review)
      standing_lapsed_desc: 'បញ្ជីដកហូតរបស់ {issuer} បានផុតកំណត់នៅថ្ងៃ {date} ដូច្នេះមិនដឹងថាតើវាបានដកហូតវិញ្ញាបនបត្រនេះហើយឬនៅទេ។ កុំចាត់ទុកថានៅមានសុពលភាពដោយផ្អែកលើទំព័រនេះតែមួយ។', // TODO(km-review)
      success_title: 'ហត្ថលេខាត្រូវបានពិនិត្យ', // TODO(km-review)
      success_desc: 'សោដែលមានក្នុងបញ្ជីទុកចិត្តបានចុះហត្ថលេខាលើព័ត៌មានខាងក្រោម។ នេះជាអ្វីដែលបានពិនិត្យ — វាមិនបញ្ជាក់ថាឯកសារនៅក្នុងដៃអ្នកជាឯកសារដែលបានចេញនោះទេ។', // TODO(km-review)
      unavailable_title: 'មិនអាចផ្ទៀងផ្ទាត់បានទេ', // TODO(km-review)
      compare_heading: 'ប្រៀបធៀបជាមួយឯកសារ', // TODO(km-review)
      compare_desc: 'ក្រដាស ឬឯកសារមិនត្រូវបានចុះហត្ថលេខាទេ។ សូមប្រៀបធៀបព័ត៌មានទាំងបួននេះជាមួយឯកសារនៅចំពោះមុខអ្នក។', // TODO(km-review)
      compare_subject: 'ឈ្មោះម្ចាស់', // TODO(km-review)
      compare_document_id: 'លេខឯកសារ', // TODO(km-review)
      compare_organisation: 'ស្ថាប័នចេញ', // TODO(km-review)
      compare_issue_date: 'កាលបរិច្ឆេទចេញ', // TODO(km-review)
      compare_not_disclosed: 'មិនបានបង្ហាញ', // TODO(km-review)
      issued_by_label: 'ចេញដោយ៖',
      accredited_badge: 'មានក្នុងបញ្ជីទុកចិត្ត ជាស្ថាប័នទទួលស្គាល់', // TODO(km-review)
      credential_details_heading: 'ព័ត៌មានវិញ្ញាបនបត្រ',
      hidden_fields_notice: 'ព័ត៌មានមួយចំនួនត្រូវបានលាក់ដោយម្ចាស់ (ការបង្ហាញដោយជ្រើសរើស)។', // TODO(km-review)
      hidden_label: 'បានលាក់៖', // TODO(km-review)
      hidden_count_label: '{count} ត្រូវបានលាក់ដោយម្ចាស់វិញ្ញាបនបត្រ', // TODO(km-review)
      link_valid_until: 'តំណមានសុពលភាពដល់៖',
      link_expiring_soon: 'តំណនេះជិតផុតកំណត់ហើយ', // TODO(km-review)
      technical_details_toggle: 'ព័ត៌មានលម្អិតបច្ចេកទេស', // TODO(km-review)
      issuer_did_label: 'លេខសម្គាល់ស្ថាប័ន (DID)៖',
      share_token_label: 'កូដតំណចែករំលែក៖', // TODO(km-review)
      verified_at_label: 'ផ្ទៀងផ្ទាត់នៅ៖', // TODO(km-review)
      format_label: 'ទម្រង់៖', // TODO(km-review)
      algorithm_label: 'ក្បួនដោះស្រាយ៖', // TODO(km-review)
      failed_title: 'ការផ្ទៀងផ្ទាត់បរាជ័យ',
      verification_steps_heading: 'ជំហានផ្ទៀងផ្ទាត់', // TODO(km-review)
      what_to_do_label: 'គួរធ្វើអ្វី៖',
      reason_label: 'មូលហេតុ៖', // TODO(km-review)
      footer_heading: 'តើ Actik ផ្ទៀងផ្ទាត់ដោយរបៀបណា?',
      trust_signature_title: 'ហត្ថលេខាគ្រីបតូ',
      trust_signature_desc: 'បង្ហាញថាសោណាមួយដែលបានចុះបញ្ជីបានចុះហត្ថលេខាលើព័ត៌មានទាំងនេះ', // TODO(km-review)
      trust_registry_title: 'បញ្ជីទុកចិត្ត',
      trust_registry_desc: 'បញ្ជីទុកចិត្តកត់ត្រាថាស្ថាប័នណាត្រូវបានទទួលស្គាល់', // TODO(km-review)
      trust_disclosure_title: 'ការបង្ហាញដោយជ្រើសរើស',
      trust_disclosure_desc: 'ម្ចាស់វិញ្ញាបនបត្រគ្រប់គ្រងអ្វីដែលអ្នកឃើញ',
      powered_by: 'ដំណើរការដោយ Actik — ភស្តុតាងនៃកម្មសិទ្ធិ', // TODO(km-review)
      learn_more: 'ស្វែងយល់បន្ថែមនៅ actik.app', // TODO(km-review)
      close: 'បិទ',
      pdf_not_supported: 'កម្មវិធីរុករកនេះមិនអាចមើល PDF ជាមុនបានទេ។', // TODO(km-review)
    }
  }
};

type I18nContextType = {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, variables?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<Language>('km');

  useEffect(() => {
    const stored = localStorage.getItem('actik_language') as Language;
    if (stored === 'en' || stored === 'km') {
      setLanguageState(stored);
    }
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('actik_language', lang);
  };

  const t = (key: string, variables?: Record<string, string | number>): string => {
    const keys = key.split('.');
    let current: any = translations[language];
    let result = key;

    for (const k of keys) {
      if (current === undefined || current[k] === undefined) {
        let fallback: any = translations['en'];
        for (const fk of keys) {
          if (fallback === undefined || fallback[fk] === undefined) {
            result = key;
            break;
          }
          fallback = fallback[fk];
        }
        if (typeof fallback === 'string') result = fallback;
        break;
      }
      current = current[k];
    }

    if (typeof current === 'string') {
      result = current;
    }

    if (variables) {
      Object.entries(variables).forEach(([k, v]) => {
        result = result.replace(new RegExp(`{${k}}`, 'g'), String(v));
      });
    }

    return result;
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
