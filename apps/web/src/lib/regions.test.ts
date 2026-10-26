import { describe, expect, it } from "vitest";
import { regionLabel, regionMatches, sortRegions } from "./regions";

describe("regionLabel", () => {
  it("spells a country code out in Persian", () => {
    expect(regionLabel("US")).toBe("آمریکا");
    expect(regionLabel("GB")).toBe("بریتانیا");
    expect(regionLabel("AE")).toBe("امارات");
    expect(regionLabel("TR")).toBe("ترکیه");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(regionLabel(" us ")).toBe("آمریکا");
  });

  it("names the non-country regions and their aliases", () => {
    expect(regionLabel("GLOBAL")).toBe("جهانی");
    expect(regionLabel("WW")).toBe("جهانی");
    expect(regionLabel("EU")).toBe("اروپا");
    expect(regionLabel("ASIA")).toBe("آسیا");
  });

  it("keeps a code it does not know rather than dropping it", () => {
    expect(regionLabel("ZZ-9")).toBe("ZZ-9");
  });

  it("is null only when there is no region", () => {
    expect(regionLabel(null)).toBeNull();
    expect(regionLabel(undefined)).toBeNull();
    expect(regionLabel("  ")).toBeNull();
  });

  it("names every officially assigned ISO 3166-1 alpha-2 code", () => {
    const assigned =
      "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
      "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
      "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
      "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
      "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
      "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
      "UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW";
    const codes = assigned.split(" ");
    expect(codes).toHaveLength(249);
    const raw = codes.filter((code) => regionLabel(code) === code);
    expect(raw).toEqual([]);
  });

  it("reads ME as Montenegro, the ISO meaning, not as the Middle East", () => {
    expect(regionLabel("ME")).toBe("مونته‌نگرو");
  });
});

describe("regionMatches", () => {
  it("finds a region by code or by part of its Persian name", () => {
    expect(regionMatches("US", "us")).toBe(true);
    expect(regionMatches("US", "آمر")).toBe(true);
    expect(regionMatches("US", "ترک")).toBe(false);
  });

  it("matches everything for an empty query", () => {
    expect(regionMatches("US", "  ")).toBe(true);
  });
});

describe("sortRegions", () => {
  it("orders by the Persian name, not the code", () => {
    const sorted = sortRegions(["US", "TR", "AE", "DE"]);
    expect(sorted).toEqual([...sorted].sort((a, b) => (regionLabel(a) ?? "").localeCompare(regionLabel(b) ?? "", "fa")));
    expect(sorted).toEqual(["DE", "US", "AE", "TR"]);
  });

  it("puts unknown codes after the named ones and does not mutate its input", () => {
    const input = ["ZZ-9", "US"];
    expect(sortRegions(input)).toEqual(["US", "ZZ-9"]);
    expect(input).toEqual(["ZZ-9", "US"]);
  });
});
