// Brand / company info shown across the admin and broker portals.  Edit THIS FILE
// once after install — every page (sidebar, login, broker portal, print receipts,
// WhatsApp templates) reads from these constants.
//
// You can also keep `name` as "Your Company" and override per-row by editing
// the printed receipts / templates directly — but the recommended workflow is to
// set these values once here, then redeploy.

export const BRAND = {
  /** Product name shown in the browser tab, login screen, sidebar header */
  product: 'BrokerPay Pro',

  /** Your real-estate company name — appears on receipts, broker portal hero, WhatsApp templates */
  company: 'Your Company',

  /** Subtitle / tagline shown under the company name in the sidebar */
  tagline: 'Broker Payout Admin',

  /** Full registered address — printed on every receipt and application form */
  address: 'Your registered office address, City, State',

  /** Public contact email */
  email: 'contact@yourcompany.com',

  /** Public website */
  website: 'www.yourcompany.com',

  /** Phone for receipts / customer support */
  phone: '',

  /** Tagline under the company name on the printed application form (Hindi acceptable) */
  applicationTagline: 'Success Starts Here',
}
