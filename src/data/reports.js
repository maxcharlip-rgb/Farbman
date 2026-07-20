'use strict';

/**
 * Sample draft reports. Prototype data only — no real tenant or financial information.
 *
 * The fixtures are built to demonstrate the exact issues stakeholders described:
 *  - Narrative notes carried over verbatim from the prior month        (Grand River AR notes)
 *  - Notes that REVERT to pre-revision text, losing the reviewer's edits (Grand River budget variance)
 *  - Incomplete sentences in narrative                                  (Grand River budget variance)
 *  - Unredacted bank account number in a public-record receivership report (Grand River bank rec note)
 *  - Cumulative YTD that does not roll forward — a propagating error    (Orchard Lake, 3rd Party)
 *  - First-period report with no baseline + missing sections            (Twelve Mile REO)
 *  - A clean report for contrast                                        (Novi Commons JV)
 *
 * narrative[key] = { title, text, revisedText? } — `revisedText` is what the
 * reviewer changed the note to during that month's review; the next month's draft
 * SHOULD start from revisedText. When it starts from `text` instead, the engine
 * catches the reverted note.
 */

const REPORTS = {
  // ───────────────────────────────────────────────────────────────────────────
  // Receivership — Grand River. Three months on file → trend + continuity.
  // ───────────────────────────────────────────────────────────────────────────
  'grand-river-42350-2026-06': {
    id: 'grand-river-42350-2026-06',
    propertyId: 'grand-river-42350',
    property: 'NAI Farbman as Receiver of 42350 Grand River Avenue — Receivership',
    division: 'Receivership',
    period: { label: 'June 1–30, 2026', month: '2026-06', type: 'PTD' },
    preparedBy: { name: 'Fatima Saleh', role: 'Property Accountant' },
    reviewedBy: { name: 'Laura LaChapelle', role: 'Property Manager', scope: 'exec_summary' },
    approvedBy: null,
    status: 'draft_pending_signoff',
    periodClose: '2026-06-30',
    preparedDate: '2026-07-09',
    reviewedDate: '2026-07-12',
    reviewDurationMinutes: 4,
    priorReportId: 'grand-river-42350-2026-05',
    // Property Overview — the receivership attributes the company's monthly
    // report format leads with (court, case, receiver, counsel, parties).
    overview: {
      address: '42350 Grand River Avenue, Novi, MI 48375',
      propertyType: 'Retail',
      yearBuilt: 1998,
      rentableSqFt: 21450,
      parking: 96,
      dateAppointed: '2025-11-03',
      court: 'Oakland County Circuit Court',
      judge: 'Hon. Victoria A. Valentine',
      caseNumber: '25CV118406',
      receiver: 'NAI Farbman by its agent M. Kalil',
      receiversCounsel: 'S. Berger of Maddin Hauser',
      plaintiff: 'Midwest Capital Lending Trust 2019-B',
      defendant: 'Grand River Retail Holdings, LLC',
      managedBy: 'Farbman Group',
    },
    // Executive-summary operational sections, in the company's standard order.
    operational: {
      receivershipOath: 'The Receivership Order was entered on 11/3/2025, appointing NAI Farbman through its authorized agent as Receiver over the real and personal property. The Receiver was authorized to take possession, collect rents, deposit all estate funds into a separate account with full contemporaneous record-keeping, avoid any conflict of interest, and otherwise act in the best interests of the estate under Michigan law and the Oakland County Circuit Court local rules.',
      suretyBond: 'A surety bond in the amount of $100,000 has been filed.',
      filingOfInventory: 'An inventory of personal property has been completed and filed with the Court.',
      leasingActivity: 'The vacant suite is being actively marketed for lease; two tours were conducted this period.',
      salesActivity: 'The building is simultaneously listed for sale on CoStar, Crexi, and LoopNet. One letter of intent is under review.',
      marketingActivity: 'Listing refreshed on all three platforms; broker e-blast sent to 1,400 contacts on 6/12.',
      significantTenantIssues: 'None to report.',
      operationalIssues: 'Parking-lot light repairs completed 6/18 following the city notice; no open violations.',
      capitalProjects: 'None to report.',
      realEstateTaxes: 'Summer levy accrued at $30,000 pending the final bill from Oakland County; see Budget Variance Notes.',
      insurance: 'Receiver-placed policy in force 1/26–12/26; premium paid current.',
      legal: 'None to report.',
      receivershipFees: 'Hourly rate of $200 for all receivership related matters.',
      protectiveAdvances: 'None to report.',
    },
    execSummary: {
      ytdNOI: -1139.15,
      ytdNOIVarianceToBudget: -55077.15,
      monthTotalRevenue: 50630.51,
      monthRevenueVarianceToBudget: 4301.51,
      monthOperatingExpenses: 47237.29,
      monthExpenseVarianceToBudget: 29391.29,
      occupancyPct: 54,
      tenants: ['Restorative Physical Medicine'],
      narrative:
        'The property remains 54% occupied with one tenant; the vacant suite is being actively ' +
        'leased, and the building is simultaneously listed for sale on CoStar, Crexi, and LoopNet.',
    },
    // PLANTED: budgetVariance is May's ORIGINAL draft (reviewer's May revision lost);
    // it also contains the incomplete sentence. arNotes is carried over verbatim.
    narrative: {
      budgetVariance: {
        title: 'Budget Variance Notes',
        text:
          'Real estate taxes over budget due to timing of summer levy. waiting on final tax bill from county',
      },
      arNotes: {
        title: 'AR Notes',
        text: 'Tenant balance of $455 relates to a disputed work order; a credit was issued pending resolution.',
      },
    },
    incomeStatement: {
      revenue: [
        { label: 'Base Rent', amount: 34874.79 },
        { label: 'Work Order Revenue', amount: -455.0 },
        { label: 'Reimbursable Expense Income (CAM/Tax/Insurance)', amount: 16210.72 },
      ],
      totalRevenue: 50630.51,
      expenses: [
        { label: 'General & Administrative', amount: 608.56 },
        { label: 'Utilities', amount: 8557.73 },
        { label: 'Repairs & Maintenance', amount: 2935.0 },
        { label: 'Insurance', amount: 2136.0 },
        { label: 'Real Property Taxes', amount: 30000.0, footnote: 1 },
        { label: 'Management Fee', amount: 3000.0 },
      ],
      totalExpenses: 47237.29,
      noiPTD: 3393.22,
    },
    balance: { beginningCash: 16190.1, netCashFlow: 6262.87, endingCash: 22452.97 },
    receivablesAging: { current: 455.0, d0_30: 0, d30_60: 0, d60_90: 0, d90_plus: 0, total: 455.0 },
    bankRec: {
      checkSequence: {
        issued: [10060, 10061, 10062, 10063, 10064, 10065],
        cleared: [10060, 10061, 10065],
        outstanding: [],
      },
      // PLANTED: full account number in a public-record receivership report.
      note:
        'Check numbers 10062–10064 do not appear in either the cleared check listing or the ' +
        'outstanding check list. Funds are swept nightly to operating account 5501237894 at Comerica.',
    },
    footnotes: { 1: 'Real estate tax accrual — timing.' },
  },

  'grand-river-42350-2026-05': {
    id: 'grand-river-42350-2026-05',
    propertyId: 'grand-river-42350',
    property: 'NAI Farbman as Receiver of 42350 Grand River Avenue — Receivership',
    division: 'Receivership',
    period: { label: 'May 1–31, 2026', month: '2026-05', type: 'PTD' },
    preparedBy: { name: 'Fatima Saleh', role: 'Property Accountant' },
    reviewedBy: { name: 'Laura LaChapelle', role: 'Property Manager', scope: 'full' },
    approvedBy: { name: 'D. Okafor', role: 'Accounting Supervisor' },
    status: 'signed_off',
    periodClose: '2026-05-31',
    preparedDate: '2026-06-06',
    reviewedDate: '2026-06-10',
    priorReportId: 'grand-river-42350-2026-04',
    execSummary: {
      ytdNOI: -4532.37,
      ytdNOIVarianceToBudget: -53875.4,
      monthTotalRevenue: 49874.79,
      monthRevenueVarianceToBudget: 3120.0,
      monthOperatingExpenses: 46436.0,
      monthExpenseVarianceToBudget: 28110.0,
      occupancyPct: 54,
      tenants: ['Restorative Physical Medicine'],
      narrative: 'The property remains 54% occupied with one tenant; the vacant suite is being marketed.',
    },
    // The reviewer REVISED budgetVariance in May (revisedText). June should
    // have started from revisedText — instead it reverted to `text`.
    narrative: {
      budgetVariance: {
        title: 'Budget Variance Notes',
        text:
          'Real estate taxes over budget due to timing of summer levy. waiting on final tax bill from county',
        revisedText:
          'Real estate taxes are over budget due to the timing of the summer tax levy; the final county ' +
          'tax bill is expected in July and the accrual will be trued up on receipt.',
      },
      arNotes: {
        title: 'AR Notes',
        text: 'Tenant balance of $455 relates to a disputed work order; a credit was issued pending resolution.',
      },
    },
    incomeStatement: {
      revenue: [
        { label: 'Base Rent', amount: 34874.79 },
        { label: 'Reimbursable Expense Income (CAM/Tax/Insurance)', amount: 15000.0 },
      ],
      totalRevenue: 49874.79,
      expenses: [
        { label: 'General & Administrative', amount: 600.0 },
        { label: 'Utilities', amount: 9200.0 },
        { label: 'Repairs & Maintenance', amount: 1500.0 },
        { label: 'Insurance', amount: 2136.0 },
        { label: 'Real Property Taxes', amount: 30000.0, footnote: 1 },
        { label: 'Management Fee', amount: 3000.0 },
      ],
      totalExpenses: 46436.0,
      noiPTD: 3438.79,
    },
    balance: { beginningCash: 12000.0, netCashFlow: 4190.1, endingCash: 16190.1 },
    receivablesAging: { current: 0, d0_30: 0, d30_60: 0, d60_90: 0, d90_plus: 0, total: 0 },
    bankRec: {
      checkSequence: { issued: [10057, 10058, 10059], cleared: [10057, 10058, 10059], outstanding: [] },
      note: 'All checks cleared. Operating account ending 7894.',
    },
    footnotes: { 1: 'Real estate tax accrual — timing.' },
  },

  'grand-river-42350-2026-04': {
    id: 'grand-river-42350-2026-04',
    propertyId: 'grand-river-42350',
    property: 'NAI Farbman as Receiver of 42350 Grand River Avenue — Receivership',
    division: 'Receivership',
    period: { label: 'April 1–30, 2026', month: '2026-04', type: 'PTD' },
    preparedBy: { name: 'Fatima Saleh', role: 'Property Accountant' },
    reviewedBy: { name: 'Laura LaChapelle', role: 'Property Manager', scope: 'full' },
    approvedBy: { name: 'D. Okafor', role: 'Accounting Supervisor' },
    status: 'signed_off',
    periodClose: '2026-04-30',
    preparedDate: '2026-05-05',
    reviewedDate: '2026-05-08',
    priorReportId: null,
    execSummary: {
      ytdNOI: -7971.16,
      monthTotalRevenue: 42874.79,
      monthOperatingExpenses: 50845.95,
      occupancyPct: 54,
      tenants: ['Restorative Physical Medicine'],
      narrative: 'The property is 54% occupied with one tenant; annual insurance and service contracts renewed in April.',
    },
    narrative: {
      budgetVariance: {
        title: 'Budget Variance Notes',
        text: 'April expenses include annual service contract renewals and the seasonal utility peak; variance will normalize over the year.',
      },
      arNotes: { title: 'AR Notes', text: 'No outstanding receivables at month end.' },
    },
    incomeStatement: {
      revenue: [
        { label: 'Base Rent', amount: 34874.79 },
        { label: 'Reimbursable Expense Income (CAM/Tax/Insurance)', amount: 8000.0 },
      ],
      totalRevenue: 42874.79,
      expenses: [
        { label: 'General & Administrative', amount: 550.0 },
        { label: 'Utilities', amount: 10245.95 },
        { label: 'Repairs & Maintenance', amount: 800.0 },
        { label: 'Insurance', amount: 3050.0 },
        { label: 'Real Property Taxes', amount: 30000.0, footnote: 1 },
        { label: 'Management Fee', amount: 3000.0 },
        { label: 'Grounds & Parking Cleanup', amount: 3200.0 },
      ],
      totalExpenses: 50845.95,
      noiPTD: -7971.16,
    },
    balance: { beginningCash: 15000.0, netCashFlow: -3000.0, endingCash: 12000.0 },
    receivablesAging: { current: 0, d0_30: 0, d30_60: 0, d60_90: 0, d90_plus: 0, total: 0 },
    bankRec: {
      checkSequence: { issued: [10054, 10055, 10056], cleared: [10054, 10055, 10056], outstanding: [] },
      note: 'All checks cleared.',
    },
    footnotes: { 1: 'Real estate tax accrual — timing.' },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Joint Venture — clean report for contrast (fresh narratives, everything ties)
  // ───────────────────────────────────────────────────────────────────────────
  'novi-commons-jv-2026-06': {
    id: 'novi-commons-jv-2026-06',
    propertyId: 'novi-commons-jv',
    property: 'Novi Commons — Farbman / Greenfield Joint Venture',
    division: 'Joint Venture',
    period: { label: 'June 1–30, 2026', month: '2026-06', type: 'PTD' },
    preparedBy: { name: 'R. Mendez', role: 'Property Accountant' },
    reviewedBy: { name: 'T. Whitfield', role: 'Property Manager', scope: 'full' },
    approvedBy: null,
    status: 'draft_pending_signoff',
    periodClose: '2026-06-30',
    preparedDate: '2026-07-07',
    reviewedDate: '2026-07-09',
    reviewDurationMinutes: 28,
    priorReportId: 'novi-commons-jv-2026-05',
    execSummary: {
      ytdNOI: null,
      monthTotalRevenue: 88240.0,
      monthRevenueVarianceToBudget: 1240.0,
      monthOperatingExpenses: 39512.44,
      monthExpenseVarianceToBudget: -1880.0,
      occupancyPct: 93,
      tenants: ['Anchor Fitness', 'Lakeshore Dental', 'Two Rivers Café', '4 others'],
      narrative: 'Stabilized multi-tenant retail; occupancy holding at 93%.',
    },
    narrative: {
      budgetVariance: {
        title: 'Budget Variance Notes',
        text: 'Repairs & maintenance ran over budget on parking lot repairs completed in June; utilities came in under budget on the mild weather.',
      },
      arNotes: {
        title: 'AR Notes',
        text: 'Anchor Fitness balance of $2,410 sits in 0–30 days; payment was received July 3 and will clear next period.',
      },
    },
    incomeStatement: {
      revenue: [
        { label: 'Base Rent', amount: 71850.0 },
        { label: 'Reimbursable Expense Income (CAM/Tax/Insurance)', amount: 16100.0 },
        { label: 'Percentage Rent', amount: 290.0 },
      ],
      totalRevenue: 88240.0,
      expenses: [
        { label: 'General & Administrative', amount: 1244.18 },
        { label: 'Utilities', amount: 12380.55 },
        { label: 'Repairs & Maintenance', amount: 6890.04 },
        { label: 'Insurance', amount: 3201.0 },
        { label: 'Real Property Taxes', amount: 11384.67 },
        { label: 'Management Fee', amount: 4412.0 },
      ],
      totalExpenses: 39512.44,
      noiPTD: 48727.56,
    },
    balance: { beginningCash: 104882.31, netCashFlow: 41203.18, endingCash: 146085.49 },
    receivablesAging: { current: 7120.0, d0_30: 2410.0, d30_60: 0, d60_90: 0, d90_plus: 0, total: 9530.0 },
    bankRec: {
      checkSequence: {
        issued: [44120, 44121, 44122, 44123],
        cleared: [44120, 44122],
        outstanding: [44121, 44123],
      },
      note: 'Outstanding checks 44121, 44123 carried to next period.',
    },
    footnotes: {},
  },

  'novi-commons-jv-2026-05': {
    id: 'novi-commons-jv-2026-05',
    propertyId: 'novi-commons-jv',
    property: 'Novi Commons — Farbman / Greenfield Joint Venture',
    division: 'Joint Venture',
    period: { label: 'May 1–31, 2026', month: '2026-05', type: 'PTD' },
    preparedBy: { name: 'R. Mendez', role: 'Property Accountant' },
    reviewedBy: { name: 'T. Whitfield', role: 'Property Manager', scope: 'full' },
    approvedBy: { name: 'D. Okafor', role: 'Accounting Supervisor' },
    status: 'signed_off',
    periodClose: '2026-05-31',
    preparedDate: '2026-06-05',
    reviewedDate: '2026-06-08',
    priorReportId: null,
    execSummary: {
      ytdNOI: null,
      monthTotalRevenue: 87010.0,
      monthOperatingExpenses: 41090.12,
      occupancyPct: 93,
      tenants: ['Anchor Fitness', 'Lakeshore Dental', 'Two Rivers Café', '4 others'],
      narrative: 'Stabilized multi-tenant retail.',
    },
    narrative: {
      budgetVariance: {
        title: 'Budget Variance Notes',
        text: 'Utilities ran slightly over budget on early-season cooling; no other material variances.',
      },
      arNotes: { title: 'AR Notes', text: 'One tenant carried a small balance at month end; it cleared in early June.' },
    },
    incomeStatement: {
      revenue: [
        { label: 'Base Rent', amount: 71850.0 },
        { label: 'Reimbursable Expense Income (CAM/Tax/Insurance)', amount: 15160.0 },
      ],
      totalRevenue: 87010.0,
      expenses: [
        { label: 'General & Administrative', amount: 1320.0 },
        { label: 'Utilities', amount: 13980.45 },
        { label: 'Repairs & Maintenance', amount: 6792.0 },
        { label: 'Insurance', amount: 3201.0 },
        { label: 'Real Property Taxes', amount: 11384.67 },
        { label: 'Management Fee', amount: 4412.0 },
      ],
      totalExpenses: 41090.12,
      noiPTD: 45919.88,
    },
    balance: { beginningCash: 70000.0, netCashFlow: 34882.31, endingCash: 104882.31 },
    receivablesAging: { current: 6100.0, d0_30: 1980.0, d30_60: 0, d60_90: 0, d90_plus: 0, total: 8080.0 },
    bankRec: {
      checkSequence: { issued: [44117, 44118, 44119], cleared: [44117, 44118, 44119], outstanding: [] },
      note: 'All checks cleared.',
    },
    footnotes: {},
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3rd Party Management — cumulative YTD break (the propagating-error case)
  // ───────────────────────────────────────────────────────────────────────────
  'orchard-lake-3p-2026-06': {
    id: 'orchard-lake-3p-2026-06',
    propertyId: 'orchard-lake-3p',
    property: 'Orchard Lake Professional Plaza — 3rd Party Management',
    division: '3rd Party',
    period: { label: 'June 1–30, 2026', month: '2026-06', type: 'PTD' },
    preparedBy: { name: 'K. Patel', role: 'Property Accountant' },
    reviewedBy: { name: 'S. Brennan', role: 'Property Manager', scope: 'full' },
    approvedBy: null,
    status: 'draft_pending_signoff',
    periodClose: '2026-06-30',
    preparedDate: '2026-07-06',
    reviewedDate: '2026-07-08',
    reviewDurationMinutes: 22,
    priorReportId: 'orchard-lake-3p-2026-05',
    execSummary: {
      // PLANTED: prior YTD 10,000 + June NOI 5,200 = 15,200 — but the summary says 18,000.
      // In cumulative reporting this error carries into April, May, June… until caught.
      ytdNOI: 18000.0,
      monthTotalRevenue: 51000.0,
      monthOperatingExpenses: 45800.0,
      occupancyPct: 88,
      tenants: ['Oakland Pediatrics', 'Birch Law Group', '9 others'],
      narrative: 'Occupancy steady at 88%; two suites are in LOI negotiation for summer occupancy.',
    },
    narrative: {
      budgetVariance: {
        title: 'Budget Variance Notes',
        text: 'Payroll and security remain elevated from the overnight coverage added in May; renewal of the service contract is under negotiation for Q3.',
      },
      arNotes: {
        title: 'AR Notes',
        text: 'Two tenants are on payment plans approved in June; balances are current under the revised schedules.',
      },
    },
    incomeStatement: {
      revenue: [
        { label: 'Base Rent', amount: 42000.0 },
        { label: 'Reimbursable Expense Income (CAM/Tax/Insurance)', amount: 9000.0 },
      ],
      totalRevenue: 51000.0,
      expenses: [
        { label: 'General & Administrative', amount: 700.0 },
        { label: 'Utilities', amount: 6800.0 },
        { label: 'Repairs & Maintenance', amount: 2100.0 },
        { label: 'Insurance', amount: 1900.0 },
        { label: 'Real Property Taxes', amount: 9500.0 },
        { label: 'Management Fee', amount: 2550.0 },
        { label: 'Payroll', amount: 11987.44 },
        { label: 'Landscaping', amount: 4250.0 },
        { label: 'Security', amount: 6012.56 },
      ],
      totalExpenses: 45800.0,
      noiPTD: 5200.0,
    },
    balance: { beginningCash: 60000.0, netCashFlow: 4800.0, endingCash: 64800.0 },
    receivablesAging: { current: 1200.0, d0_30: 800.0, d30_60: 0, d60_90: 0, d90_plus: 0, total: 2000.0 },
    bankRec: {
      checkSequence: { issued: [2201, 2202, 2203], cleared: [2201, 2202], outstanding: [2203] },
      note: 'Check 2203 outstanding, issued June 29.',
    },
    footnotes: {},
  },

  'orchard-lake-3p-2026-05': {
    id: 'orchard-lake-3p-2026-05',
    propertyId: 'orchard-lake-3p',
    property: 'Orchard Lake Professional Plaza — 3rd Party Management',
    division: '3rd Party',
    period: { label: 'May 1–31, 2026', month: '2026-05', type: 'PTD' },
    preparedBy: { name: 'K. Patel', role: 'Property Accountant' },
    reviewedBy: { name: 'S. Brennan', role: 'Property Manager', scope: 'full' },
    approvedBy: { name: 'D. Okafor', role: 'Accounting Supervisor' },
    status: 'signed_off',
    periodClose: '2026-05-31',
    preparedDate: '2026-06-04',
    reviewedDate: '2026-06-06',
    priorReportId: null,
    execSummary: {
      ytdNOI: 10000.0,
      monthTotalRevenue: 50500.0,
      monthOperatingExpenses: 45600.0,
      occupancyPct: 88,
      tenants: ['Oakland Pediatrics', 'Birch Law Group', '9 others'],
      narrative: 'Occupancy held at 88% through May.',
    },
    narrative: {
      budgetVariance: {
        title: 'Budget Variance Notes',
        text: 'Security coverage was added overnight in May; expect elevated payroll through Q3.',
      },
      arNotes: { title: 'AR Notes', text: 'One tenant carried a small balance; it cleared in early June.' },
    },
    incomeStatement: {
      revenue: [
        { label: 'Base Rent', amount: 42000.0 },
        { label: 'Reimbursable Expense Income (CAM/Tax/Insurance)', amount: 8500.0 },
      ],
      totalRevenue: 50500.0,
      expenses: [
        { label: 'General & Administrative', amount: 700.0 },
        { label: 'Utilities', amount: 6700.0 },
        { label: 'Repairs & Maintenance', amount: 2000.0 },
        { label: 'Insurance', amount: 1900.0 },
        { label: 'Real Property Taxes', amount: 9500.0 },
        { label: 'Management Fee', amount: 2550.0 },
        { label: 'Payroll', amount: 11912.3 },
        { label: 'Landscaping', amount: 4250.0 },
        { label: 'Security', amount: 6087.7 },
      ],
      totalExpenses: 45600.0,
      noiPTD: 4900.0,
    },
    balance: { beginningCash: 55600.0, netCashFlow: 4400.0, endingCash: 60000.0 },
    receivablesAging: { current: 900.0, d0_30: 600.0, d30_60: 0, d60_90: 0, d90_plus: 0, total: 1500.0 },
    bankRec: {
      checkSequence: { issued: [2198, 2199, 2200], cleared: [2198, 2199, 2200], outstanding: [] },
      note: 'All checks cleared.',
    },
    footnotes: {},
  },

  // ───────────────────────────────────────────────────────────────────────────
  // REO — first period, no baseline, missing sections. The "unique case".
  // ───────────────────────────────────────────────────────────────────────────
  'twelve-mile-reo-2026-06': {
    id: 'twelve-mile-reo-2026-06',
    propertyId: 'twelve-mile-reo',
    property: '28000 Twelve Mile Road — REO (Lender-Owned)',
    division: 'REO',
    period: { label: 'June 1–30, 2026', month: '2026-06', type: 'PTD' },
    preparedBy: { name: 'J. Park', role: 'Property Accountant' },
    reviewedBy: null,
    approvedBy: null,
    status: 'draft_pending_signoff',
    periodClose: '2026-06-30',
    preparedDate: '2026-07-11',
    reviewedDate: null,
    priorReportId: null,
    execSummary: {
      ytdNOI: null,
      monthTotalRevenue: 0.0,
      monthOperatingExpenses: 14820.5,
      occupancyPct: 0,
      tenants: [],
      narrative:
        'Asset taken into REO on 2026-05-26. Vacant; carrying costs only this period. ' +
        'Property is being prepared for disposition.',
    },
    // narrative sections intentionally absent → sections-missing finding
    incomeStatement: {
      revenue: [{ label: 'Base Rent', amount: 0.0 }],
      totalRevenue: 0.0,
      expenses: [
        { label: 'Utilities', amount: 2310.5 },
        { label: 'Repairs & Maintenance', amount: 6500.0 },
        { label: 'Insurance', amount: 1010.0 },
        { label: 'Real Property Taxes', amount: 5000.0 },
      ],
      totalExpenses: 14820.5,
      noiPTD: -14820.5,
    },
    balance: { beginningCash: 25000.0, netCashFlow: -14820.5, endingCash: 10179.5 },
    receivablesAging: { current: 0, d0_30: 0, d30_60: 0, d60_90: 0, d90_plus: 0, total: 0 },
    // bankRec intentionally omitted — engine reports "could not verify".
    footnotes: {},
  },
};

const PROPERTIES = [
  {
    id: 'grand-river-42350',
    code: 'GR42350',
    status: 'active',
    name: 'NAI Farbman as Receiver of 42350 Grand River Avenue — Receivership',
    division: 'Receivership',
    currentReportId: 'grand-river-42350-2026-06',
    // The owner rep for a receivership is the lender's asset manager (report is
    // also filed with the court). Addresses use the reserved .example TLD.
    ownerRep: { name: 'Karen Whitlock', title: 'Asset Manager', org: 'Midwest Capital Partners (Lender)', email: 'kwhitlock@midwestcapital.example' },
  },
  {
    id: 'novi-commons-jv',
    code: 'NOVICJV',
    status: 'active',
    name: 'Novi Commons — Farbman / Greenfield Joint Venture',
    division: 'Joint Venture',
    currentReportId: 'novi-commons-jv-2026-06',
    ownerRep: { name: 'Greg Toland', title: 'JV Partner Representative', org: 'Greenfield Partners', email: 'gtoland@greenfieldpartners.example' },
  },
  {
    id: 'orchard-lake-3p',
    code: 'ORCHLK3P',
    status: 'active',
    name: 'Orchard Lake Professional Plaza — 3rd Party Management',
    division: '3rd Party',
    currentReportId: 'orchard-lake-3p-2026-06',
    ownerRep: { name: 'Susan Alvarez', title: 'Owner Representative', org: 'Orchard Lake Owners LLC', email: 'salvarez@orchardlakeowners.example' },
  },
  {
    id: 'twelve-mile-reo',
    code: 'TWMILREO',
    status: 'active',
    name: '28000 Twelve Mile Road — REO (Lender-Owned)',
    division: 'REO',
    currentReportId: 'twelve-mile-reo-2026-06',
    ownerRep: { name: 'Dan Kroll', title: 'REO Asset Manager', org: 'First Michigan Bank — REO Dept', email: 'dkroll@firstmichigan.example' },
  },
];

// Portfolio counts shown in the header (illustrative).
const DIVISION_COUNTS = { Receivership: 37, 'Joint Venture': 31, '3rd Party': 81, REO: 16 };

// One-line context per division, shown when the portfolio is filtered.
const DIVISION_BLURBS = {
  Receivership: '37 active receivership properties across MI, IL, OH, WI, AL, and IA. Reports are filed with the court and become public record.',
  'Joint Venture': '31 joint-venture assets with partner reporting requirements.',
  '3rd Party': '81 fee-managed properties reporting to outside owners.',
  REO: '16 lender-owned assets being carried through disposition.',
};

function getReport(id) {
  return REPORTS[id] || null;
}

// ── Monthly property-code roster ───────────────────────────────────────────
// The property list that circulates monthly (in production, straight out of
// Yardi). The tool reconciles its roster against this so nobody re-keys
// properties. Match key is the property CODE.
const PROPERTY_LIST_TEMPLATE = `code,name,division,owner_rep,owner_rep_email
GR42350,NAI Farbman as Receiver of 42350 Grand River Avenue — Receivership,Receivership,Karen Whitlock,kwhitlock@midwestcapital.example
NOVICJV,Novi Commons — Farbman / Greenfield Joint Venture,Joint Venture,Greg Toland,gtoland@greenfieldpartners.example
`;

// A realistic monthly list: the 4 current properties (unchanged) plus two new
// ones that were added to the portfolio this month — the tool picks them up
// automatically, no manual entry.
const SAMPLE_PROPERTY_LIST = `code,name,division,owner_rep,owner_rep_email
GR42350,NAI Farbman as Receiver of 42350 Grand River Avenue — Receivership,Receivership,Karen Whitlock,kwhitlock@midwestcapital.example
NOVICJV,Novi Commons — Farbman / Greenfield Joint Venture,Joint Venture,Greg Toland,gtoland@greenfieldpartners.example
ORCHLK3P,Orchard Lake Professional Plaza — 3rd Party Management,3rd Party,Susan Alvarez,salvarez@orchardlakeowners.example
TWMILREO,28000 Twelve Mile Road — REO (Lender-Owned),REO,Dan Kroll,dkroll@firstmichigan.example
SOUTHFLD3P,Southfield Town Center — 3rd Party Management,3rd Party,Marcus Bell,mbell@southfieldowners.example
LIVREC001,NAI Farbman as Receiver of 19500 Middlebelt — Receivership,Receivership,Priya Nair,pnair@lakeshorelending.example
`;

module.exports = { REPORTS, PROPERTIES, DIVISION_COUNTS, DIVISION_BLURBS, getReport, PROPERTY_LIST_TEMPLATE, SAMPLE_PROPERTY_LIST };
