// Russell 1000 constituents NOT in S&P 500 — extends the screener pool.
// Sourced from Wikipedia's Russell 1000 Index page.
// Tickers with share-class suffixes (e.g. BF-A) excluded.
//
// Last refreshed: 2026-05-22

export const RUSSELL_EXTRA: readonly string[] = [
  // A
  'AA', 'AAL', 'AAON', 'ACHC', 'ACI', 'ACM', 'ADC', 'ADT',
  'AFG', 'AFRM', 'AGCO', 'AGNC', 'AGO', 'AIT', 'AL', 'ALAB',
  'ALGM', 'ALK', 'ALLY', 'ALNY', 'ALSN', 'AM', 'AMG', 'AMH',
  'AMKR', 'AMTM', 'AN', 'APG', 'APPF', 'AR', 'ARMK', 'ARW',
  'AS', 'ASH', 'ASTS', 'ATI', 'ATR', 'AU', 'AUR', 'AVT',
  'AVTR', 'AWI', 'AXS', 'AXTA', 'AYI',
  // B
  'BAH', 'BAM', 'BBWI', 'BC', 'BEPC', 'BFAM', 'BHF', 'BILL',
  'BIO', 'BIRK', 'BJ', 'BLD', 'BLSH', 'BMRN', 'BNY', 'BOKF',
  'BPOP', 'BRBR', 'BRKR', 'BROS', 'BRX', 'BSY', 'BURL', 'BWA',
  'BWXT', 'BYD',
  // C
  'CACC', 'CACI', 'CAI', 'CAR', 'CART', 'CAVA', 'CBC', 'CBSH',
  'CCC', 'CCK', 'CE', 'CELH', 'CERT', 'CFR', 'CG', 'CGNX',
  'CHDN', 'CHE', 'CHH', 'CHRD', 'CHWY', 'CLF', 'CLH', 'CLVT',
  'CNA', 'CNH', 'CNM', 'CNXC', 'COKE', 'COLB', 'COLD', 'COLM',
  'CORT', 'COTY', 'CPNG', 'CR', 'CRCL', 'CROX', 'CRS', 'CRUS',
  'CSL', 'CUBE', 'CUZ', 'CW', 'CWEN', 'CXT', 'CZR',
  // D
  'DAR', 'DBX', 'DCI', 'DDS', 'DINO', 'DJT', 'DKNG', 'DKS',
  'DLB', 'DOCS', 'DOCU', 'DOX', 'DRS', 'DT', 'DTM', 'DUOL',
  'DV', 'DXC',
  // E
  'ECG', 'EEFT', 'EGP', 'EHC', 'ELAN', 'ELF', 'ELS', 'EMN',
  'ENPH', 'ENTG', 'EPR', 'EQH', 'ESAB', 'ESI', 'ESTC', 'ETSY',
  'EVR', 'EWBC', 'EXEL', 'EXLS', 'EXP',
  // F
  'FAF', 'FBIN', 'FCN', 'FCNCA', 'FERG', 'FHB', 'FHN', 'FIGR',
  'FIVE', 'FLEX', 'FLO', 'FLS', 'FLUT', 'FMC', 'FNB', 'FND',
  'FNF', 'FOUR', 'FR', 'FRHC', 'FRMI', 'FRPT', 'FTAI', 'FTI',
  'FWONA', 'FWONK',
  // G
  'G', 'GAP', 'GFS', 'GGG', 'GLIBA', 'GLIBK', 'GLOB', 'GLPI',
  'GME', 'GMED', 'GNTX', 'GPK', 'GTES', 'GTLB', 'GTM', 'GWRE',
  'GXO',
  // H
  'H', 'HALO', 'HAYW', 'HEI', 'HHH', 'HIW', 'HLI', 'HLNE',
  'HOG', 'HR', 'HRB', 'HUBS', 'HUN', 'HXL',
  // I
  'IAC', 'IDA', 'ILMN', 'INGM', 'INGR', 'INSM', 'INSP', 'IONQ',
  'IONS', 'IOT', 'IPGP', 'IRDM', 'ITT',
  // J
  'JAZZ', 'JEF', 'JHG', 'JHX', 'JLL',
  // K
  'KBR', 'KD', 'KEX', 'KMPR', 'KMX', 'KNSL', 'KNX', 'KRC',
  'KRMN',
  // L
  'LAD', 'LAMR', 'LAZ', 'LBRDA', 'LBRDK', 'LBTYA', 'LBTYK', 'LCID',
  'LEA', 'LECO', 'LFUS', 'LINE', 'LKQ', 'LLYVA', 'LLYVK', 'LNC',
  'LNG', 'LOAR', 'LOPE', 'LPLA', 'LPX', 'LSCC', 'LSTR', 'LW',
  'LYFT',
  // M
  'M', 'MAN', 'MANH', 'MASI', 'MAT', 'MDB', 'MDLN', 'MDU',
  'MEDP', 'MHK', 'MIDD', 'MKL', 'MKSI', 'MKTX', 'MLI', 'MOH',
  'MORN', 'MP', 'MPT', 'MRP', 'MRVL', 'MSA', 'MSGS', 'MSM',
  'MSTR', 'MTCH', 'MTDR', 'MTG', 'MTN', 'MTSI', 'MTZ', 'MUSA',
  // N
  'NBIX', 'NCNO', 'NET', 'NEU', 'NFG', 'NIQ', 'NLY', 'NNN',
  'NOV', 'NSA', 'NTNX', 'NTRA', 'NU', 'NVST', 'NVT', 'NWL',
  'NXST', 'NYT',
  // O
  'OC', 'OGE', 'OGN', 'OHI', 'OKTA', 'OLED', 'OLLI', 'OLN',
  'OMF', 'ONON', 'ONTO', 'ORI', 'OSK', 'OVV', 'OWL', 'OZK',
  // P
  'PAG', 'PATH', 'PAYC', 'PB', 'PCOR', 'PCTY', 'PEGA', 'PEN',
  'PENN', 'PFGC', 'PINS', 'PK', 'PLNT', 'PNFP', 'POST', 'PPC',
  'PR', 'PRGO', 'PRI', 'PRMB', 'PSN', 'PSTG', 'PVH',
  // Q
  'QGEN', 'QRVO', 'QS', 'QSR', 'QXO',
  // R
  'R', 'RAL', 'RARE', 'RBA', 'RBC', 'RBLX', 'RBRK', 'RDDT',
  'REXR', 'REYN', 'RGA', 'RGEN', 'RGLD', 'RH', 'RHI', 'RITM',
  'RIVN', 'RKLB', 'RKT', 'RLI', 'RNG', 'RNR', 'ROIV', 'ROKU',
  'RPM', 'RPRX', 'RRC', 'RRX', 'RS', 'RVMD', 'RYAN', 'RYN',
  // S
  'S', 'SAIA', 'SAIC', 'SAIL', 'SAM', 'SARO', 'SCCO', 'SCI',
  'SEB', 'SEIC', 'SF', 'SFD', 'SFM', 'SGI', 'SHC', 'SHOP',
  'SIRI', 'SITE', 'SLGN', 'SLM', 'SMG', 'SMMT', 'SN', 'SNDR',
  'SNOW', 'SNX', 'SOFI', 'SOLS', 'SON', 'SPOT', 'SRPT', 'SSB',
  'SSD', 'SSNC', 'ST', 'STAG', 'STWD', 'SUI',
  // T
  'TDC', 'TEAM', 'TEM', 'TFSL', 'TFX', 'THC', 'THG', 'THO',
  'TIGO', 'TKR', 'TLN', 'TNL', 'TOL', 'TOST', 'TPG', 'TREX',
  'TRU', 'TSM', 'TTC', 'TTEK', 'TW', 'TWLO', 'TXRH',
  // U
  'U', 'UA', 'UAA', 'UGI', 'UHAL', 'UI', 'UNM', 'USFD',
  'UTHR', 'UWMC',
  // V
  'VFC', 'VGNT', 'VIK', 'VIRT', 'VKTX', 'VMI', 'VNO', 'VNOM',
  'VNT', 'VOYA', 'VSNT', 'VVV',
  // W
  'W', 'WAL', 'WBS', 'WCC', 'WEN', 'WEX', 'WFRD', 'WH',
  'WHR', 'WING', 'WLK', 'WMS', 'WPC', 'WSC', 'WSO', 'WTFC',
  'WTM', 'WTRG', 'WU', 'WWD',
  // X
  'XP', 'XPO', 'XRAY',
  // Y
  'YETI',
  // Z
  'Z', 'ZG', 'ZION', 'ZM', 'ZS',
];
