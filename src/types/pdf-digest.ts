export interface PdfBrandDigest {
  brandFacts: {
    brandName: string;
    companyName: string;
    industry: string;
    businessModel: string;
    productOrService: string;
    targetCustomers: string[];
    coreSellingPoints: string[];
    proofPoints: string[];
    brandTone: string[];
    complianceNotes: string[];
  };
  videoMarketingDigest: {
    hookAngles: string[];
    contentPillars: string[];
    storyAngles: string[];
    visualSignals: string[];
    ctaAngles: string[];
    mustMention: string[];
    mustAvoid: string[];
  };
  evidence: Array<{
    insight: string;
    sources: string[];
  }>;
}
