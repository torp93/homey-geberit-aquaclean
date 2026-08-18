'use strict';

// Every error code from the official Geberit AquaClean Mera service manual,
// 967.008.00.0(04) (05-2023), sections "Tableaux des codes erreur". The manual
// displays codes as four hex digits (040B, 050F) and so does the remote
// control's display — the app shows the same format so a code can be compared
// against Geberit's own screens without conversion.
//
// The toilet reports the code as a plain number over BLE (system parameter 6):
// 0x040B arrives as 1035. formatErrorCode() turns that number back into the
// manual's notation and attaches the manual's description of what is wrong.
//
// Verified live: LAST_ERROR read 1035 while the Geberit app showed 040B for
// the same fault (2026-08-18, spray arm drive on a Mera Comfort).
//
// Descriptions name the functional module and the fault. Causes and repair
// measures stay in the manual and docs/ERROR_CODES.md — the app answers
// "what is wrong", not "how to repair it".

const CODES = Object.freeze({
  // 01xx — Main control / Hovedstyring
  0x0100: { en: 'Main control: factory data write failed', no: 'Hovedstyring: lagring av fabrikkdata feilet' },
  0x0101: { en: 'Main control: operating data write failed', no: 'Hovedstyring: lagring av driftsdata feilet' },
  0x0108: { en: 'Main control: sequence control got no feedback from a module', no: 'Hovedstyring: sekvensstyringen fikk ikke svar fra en modul' },
  0x0109: { en: 'Main control: power supply current interrupted', no: 'Hovedstyring: strømbrudd i strømforsyningen' },
  0x010A: { en: 'Main control: power supply leakage current', no: 'Hovedstyring: lekkasjestrøm i strømforsyningen' },
  0x010B: { en: 'Main control: 24 V supply missing', no: 'Hovedstyring: 24 V-forsyning mangler' },
  0x010C: { en: 'Main control: 24 V leakage current', no: 'Hovedstyring: lekkasjestrøm på 24 V' },
  0x010D: { en: 'Main control: 230 V supply missing', no: 'Hovedstyring: 230 V-forsyning mangler' },
  0x010E: { en: 'Main control: 230 V leakage current', no: 'Hovedstyring: lekkasjestrøm på 230 V' },
  0x010F: { en: 'Main control: 230 V continuous overcurrent', no: 'Hovedstyring: vedvarende overstrøm på 230 V' },
  0x0110: { en: 'Main control: 230 V brief overcurrent', no: 'Hovedstyring: kortvarig overstrøm på 230 V' },
  0x0111: { en: 'Main control: 230 V current interrupted', no: 'Hovedstyring: strømbrudd på 230 V' },
  0x0128: { en: 'Odour extraction controller not found', no: 'Fant ikke styringen for luktavsuget' },
  0x0129: { en: 'Shower unit controller not found', no: 'Fant ikke styringen for dusjenheten' },
  0x012A: { en: 'Lid lever controller not found', no: 'Fant ikke styringen for lokkløfteren' },
  0x012B: { en: 'Dryer module controller not found', no: 'Fant ikke styringen for tørkermodulen' },
  0x012C: { en: 'Hot water controller not found', no: 'Fant ikke styringen for varmtvannsproduksjonen' },
  0x012D: { en: 'Seat heating controller not found', no: 'Fant ikke styringen for setevarmen' },
  0x012E: { en: 'Lateral control panel not found', no: 'Fant ikke sidepanelet' },
  0x012F: { en: 'User detection not found', no: 'Fant ikke brukergjenkjenningen' },
  0x0130: { en: 'Proximity sensor not found', no: 'Fant ikke nærhetssensoren' },
  0x0131: { en: 'Orientation light not found', no: 'Fant ikke orienteringslyset' },
  0x0132: { en: 'Dryer assembly not found', no: 'Fant ikke tørkerenheten' },
  0x0133: { en: 'Instantaneous water heater not found', no: 'Fant ikke gjennomstrømningsvarmeren' },
  0x0134: { en: 'Shower unit: no feedback', no: 'Dusjenhet: svarer ikke' },
  0x0135: { en: 'Lid lever: no feedback', no: 'Lokkløfter: svarer ikke' },
  0x0136: { en: 'Hot water production: no feedback', no: 'Varmtvannsproduksjon: svarer ikke' },
  0x0137: { en: 'User detection: no feedback', no: 'Brukergjenkjenning: svarer ikke' },
  0x0138: { en: 'Proximity sensor: no feedback', no: 'Nærhetssensor: svarer ikke' },
  0x0139: { en: 'Dryer assembly: no feedback', no: 'Tørkerenhet: svarer ikke' },
  0x013A: { en: 'Descaling process failed', no: 'Avkalkingsprosessen mislyktes' },

  // 03xx — Odour extraction / Luktavsug
  0x0300: { en: 'Odour extraction: factory data write failed', no: 'Luktavsug: lagring av fabrikkdata feilet' },
  0x0301: { en: 'Odour extraction: operating data write failed', no: 'Luktavsug: lagring av driftsdata feilet' },
  0x0308: { en: 'Odour extraction: 24 V supply missing', no: 'Luktavsug: 24 V-forsyning mangler' },
  0x0309: { en: 'Odour extraction: 24 V overcurrent', no: 'Luktavsug: overstrøm på 24 V' },
  0x030A: { en: 'Odour extraction: 24 V leakage current', no: 'Luktavsug: lekkasjestrøm på 24 V' },
  0x030B: { en: 'Odour extraction: fan current interrupted', no: 'Luktavsug: strømbrudd i viften' },

  // 04xx — Shower unit / Dusjenhet
  0x0400: { en: 'Shower unit: factory data write failed', no: 'Dusjenhet: lagring av fabrikkdata feilet' },
  0x0401: { en: 'Shower unit: operating data write failed', no: 'Dusjenhet: lagring av driftsdata feilet' },
  0x0408: { en: 'Shower unit: 24 V supply missing', no: 'Dusjenhet: 24 V-forsyning mangler' },
  0x0409: { en: 'Shower unit: 24 V overcurrent', no: 'Dusjenhet: overstrøm på 24 V' },
  0x040A: { en: 'Shower unit: 24 V leakage current', no: 'Dusjenhet: lekkasjestrøm på 24 V' },
  0x040B: { en: 'Shower unit: spray arm drive lost its reference (missing/corroded magnet, wiring or defective module)', no: 'Dusjenhet: dusjarmens drivverk har mistet referansen (magnet som mangler/er korrodert, kabling eller defekt modul)' },
  0x040C: { en: 'Shower unit: multi-way valve lost its reference (mechanical blockage)', no: 'Dusjenhet: flerveisventilen har mistet referansen (mekanisk blokkering)' },
  0x040D: { en: 'Shower unit: spray arm drive step loss (blocked, dirty or defective)', no: 'Dusjenhet: dusjarmens drivverk mister steg (blokkert, tilsmusset eller defekt)' },
  0x040E: { en: 'Shower unit: multi-way valve step loss (blocked or defective)', no: 'Dusjenhet: flerveisventilen mister steg (blokkert eller defekt)' },

  // 05xx — Lid lever / Lokkløfter (Mera Comfort)
  0x0500: { en: 'Lid lever: factory data write failed', no: 'Lokkløfter: lagring av fabrikkdata feilet' },
  0x0501: { en: 'Lid lever: operating data write failed', no: 'Lokkløfter: lagring av driftsdata feilet' },
  0x0508: { en: 'Lid lever: 24 V supply missing', no: 'Lokkløfter: 24 V-forsyning mangler' },
  0x0509: { en: 'Lid lever: 24 V overcurrent', no: 'Lokkløfter: overstrøm på 24 V' },
  0x050A: { en: 'Lid lever: 24 V leakage current', no: 'Lokkløfter: lekkasjestrøm på 24 V' },
  0x050B: { en: 'Lid lever: angle sensor shorted to supply voltage', no: 'Lokkløfter: vinkelsensor kortsluttet mot forsyningsspenning' },
  0x050C: { en: 'Lid lever: angle sensor shorted to ground', no: 'Lokkløfter: vinkelsensor kortsluttet mot jord' },
  0x050D: { en: 'Lid lever: motor overload from constant opening/closing (self-resets after 15 minutes)', no: 'Lokkløfter: motor overbelastet av stadig åpning/lukking (nullstiller seg selv etter 15 minutter)' },
  0x050E: { en: 'Lid lever: WC lid blocked (opening force too high or defective module)', no: 'Lokkløfter: lokket er blokkert (for høy åpningskraft eller defekt modul)' },
  0x050F: { en: 'Lid lever: WC lid lost its reference (mechanical blockage or defective motor)', no: 'Lokkløfter: lokket har mistet referansen (mekanisk blokkering eller defekt motor)' },

  // 06xx — Dryer module / Tørkermodul
  0x0600: { en: 'Dryer module: factory data write failed', no: 'Tørkermodul: lagring av fabrikkdata feilet' },
  0x0601: { en: 'Dryer module: operating data write failed', no: 'Tørkermodul: lagring av driftsdata feilet' },
  0x0608: { en: 'Dryer module: 24 V supply missing', no: 'Tørkermodul: 24 V-forsyning mangler' },
  0x0609: { en: 'Dryer module: 24 V overcurrent', no: 'Tørkermodul: overstrøm på 24 V' },
  0x060A: { en: 'Dryer module: 24 V leakage current', no: 'Tørkermodul: lekkasjestrøm på 24 V' },
  0x060B: { en: 'Dryer module: fan current interrupted', no: 'Tørkermodul: strømbrudd i viften' },
  0x060C: { en: 'Dryer module: fan current out of tolerance', no: 'Tørkermodul: viftestrøm utenfor toleranse' },
  0x060D: { en: 'Dryer module: fan speed out of tolerance', no: 'Tørkermodul: viftehastighet utenfor toleranse' },
  0x0610: { en: 'Dryer module: mains voltage missing', no: 'Tørkermodul: nettspenning mangler' },
  0x0611: { en: 'Dryer module: 230 V continuous overcurrent', no: 'Tørkermodul: vedvarende overstrøm på 230 V' },
  0x0612: { en: 'Dryer module: 230 V brief overcurrent', no: 'Tørkermodul: kortvarig overstrøm på 230 V' },
  0x0613: { en: 'Dryer module: 230 V leakage current', no: 'Tørkermodul: lekkasjestrøm på 230 V' },
  0x0614: { en: 'Dryer module: heating current interrupted', no: 'Tørkermodul: strømbrudd i varmeelementet' },
  0x0615: { en: 'Dryer module: heating overheated', no: 'Tørkermodul: varmeelementet er overopphetet' },
  0x0616: { en: 'Dryer module: temperature sensor open circuit', no: 'Tørkermodul: brudd i temperatursensoren' },
  0x0617: { en: 'Dryer module: temperature sensor short circuit', no: 'Tørkermodul: kortslutning i temperatursensoren' },
  0x0618: { en: 'Dryer module: temperature sensor error', no: 'Tørkermodul: feil i temperatursensoren' },

  // 07xx — Hot water production / Varmtvannsproduksjon
  0x0700: { en: 'Hot water: factory data write failed', no: 'Varmtvann: lagring av fabrikkdata feilet' },
  0x0701: { en: 'Hot water: operating data write failed', no: 'Varmtvann: lagring av driftsdata feilet' },
  0x0708: { en: 'Hot water: 24 V supply missing', no: 'Varmtvann: 24 V-forsyning mangler' },
  0x0709: { en: 'Hot water: solenoid valve current interrupted', no: 'Varmtvann: strømbrudd i magnetventilen' },
  0x070A: { en: 'Hot water: solenoid valve overcurrent', no: 'Varmtvann: overstrøm i magnetventilen' },
  0x070B: { en: 'Hot water: solenoid valve leakage current', no: 'Varmtvann: lekkasjestrøm i magnetventilen' },
  0x070C: { en: 'Hot water: boiler temperature sensor open circuit', no: 'Varmtvann: brudd i tankens temperatursensor' },
  0x070D: { en: 'Hot water: boiler temperature sensor short circuit', no: 'Varmtvann: kortslutning i tankens temperatursensor' },
  0x070E: { en: 'Hot water: outlet temperature sensor open circuit', no: 'Varmtvann: brudd i utløpets temperatursensor' },
  0x070F: { en: 'Hot water: outlet temperature sensor short circuit', no: 'Varmtvann: kortslutning i utløpets temperatursensor' },
  0x0710: { en: 'Hot water: boiler temperature sensor reports overheating', no: 'Varmtvann: tankens temperatursensor melder overoppheting' },
  0x0711: { en: 'Hot water: outlet temperature sensor reports overheating', no: 'Varmtvann: utløpets temperatursensor melder overoppheting' },
  0x0712: { en: 'Hot water: temperature regulation error', no: 'Varmtvann: feil i temperaturreguleringen' },
  0x0713: { en: 'Hot water: 230 V supply missing', no: 'Varmtvann: 230 V-forsyning mangler' },
  0x0714: { en: 'Hot water: heating element current interrupted (thermal cutout may have tripped)', no: 'Varmtvann: strømbrudd i varmeelementet (termosikringen kan ha løst ut)' },
  0x0715: { en: 'Hot water: heating element continuous overcurrent', no: 'Varmtvann: vedvarende overstrøm i varmeelementet' },
  0x0716: { en: 'Hot water: heating element brief overcurrent', no: 'Varmtvann: kortvarig overstrøm i varmeelementet' },
  0x0717: { en: 'Hot water: heating element leakage current', no: 'Varmtvann: lekkasjestrøm i varmeelementet' },
  0x0718: { en: 'Hot water: instantaneous heater pump current interrupted', no: 'Varmtvann: strømbrudd i gjennomstrømningsvarmerens pumpe' },
  0x0719: { en: 'Hot water: instantaneous heater pump overcurrent', no: 'Varmtvann: overstrøm i gjennomstrømningsvarmerens pumpe' },
  0x071A: { en: 'Hot water: instantaneous heater pump leakage current', no: 'Varmtvann: lekkasjestrøm i gjennomstrømningsvarmerens pumpe' },
  0x071B: { en: 'Hot water: boiler pump current interrupted', no: 'Varmtvann: strømbrudd i tankpumpen' },
  0x071C: { en: 'Hot water: boiler pump overcurrent', no: 'Varmtvann: overstrøm i tankpumpen' },
  0x071D: { en: 'Hot water: boiler pump leakage current', no: 'Varmtvann: lekkasjestrøm i tankpumpen' },
  0x071E: { en: 'Hot water: cold water fill level sensor error (may be scaled/dirty)', no: 'Varmtvann: feil i nivåsensoren for kaldtvann (kan være forkalket/tilsmusset)' },
  0x071F: { en: 'Hot water: hot water fill level sensor error (may be scaled/dirty)', no: 'Varmtvann: feil i nivåsensoren for varmtvann (kan være forkalket/tilsmusset)' },
  0x0728: { en: 'Hot water: cold water level rises too slowly (check water supply)', no: 'Varmtvann: kaldtvannsnivået stiger for sakte (sjekk vanntilførselen)' },
  0x0729: { en: 'Hot water: hot water level rises too slowly (check water supply)', no: 'Varmtvann: varmtvannsnivået stiger for sakte (sjekk vanntilførselen)' },
  0x072A: { en: 'Hot water: cold water level falls too slowly', no: 'Varmtvann: kaldtvannsnivået synker for sakte' },
  0x072B: { en: 'Hot water: hot water level falls too slowly', no: 'Varmtvann: varmtvannsnivået synker for sakte' },

  // 08xx — Seat heating / Setevarme (Mera Comfort)
  0x0800: { en: 'Seat heating: factory data write failed', no: 'Setevarme: lagring av fabrikkdata feilet' },
  0x0801: { en: 'Seat heating: operating data write failed', no: 'Setevarme: lagring av driftsdata feilet' },
  0x0810: { en: 'Seat heating: 230 V supply missing', no: 'Setevarme: 230 V-forsyning mangler' },
  0x0811: { en: 'Seat heating: 230 V continuous overcurrent', no: 'Setevarme: vedvarende overstrøm på 230 V' },
  0x0812: { en: 'Seat heating: 230 V brief overcurrent', no: 'Setevarme: kortvarig overstrøm på 230 V' },
  0x0813: { en: 'Seat heating: 230 V leakage current', no: 'Setevarme: lekkasjestrøm på 230 V' },
  0x0814: { en: 'Seat heating: heating foil current interrupted', no: 'Setevarme: strømbrudd i varmefolien' },
  0x0815: { en: 'Seat heating: heating foil overheated', no: 'Setevarme: varmefolien er overopphetet' },
  0x0816: { en: 'Seat heating: temperature sensor open circuit', no: 'Setevarme: brudd i temperatursensoren' },
  0x0817: { en: 'Seat heating: temperature sensor short circuit', no: 'Setevarme: kortslutning i temperatursensoren' },
  0x0818: { en: 'Seat heating: temperature regulation error', no: 'Setevarme: feil i temperaturreguleringen' },

  // 09xx — Lateral control panel / Sidepanel
  0x0900: { en: 'Control panel: factory data write failed', no: 'Sidepanel: lagring av fabrikkdata feilet' },
  0x0901: { en: 'Control panel: operating data write failed', no: 'Sidepanel: lagring av driftsdata feilet' },
  0x0908: { en: 'Control panel: button permanently pressed (check the left design cover)', no: 'Sidepanel: en knapp registreres som konstant inntrykket (sjekk venstre designdeksel)' },

  // 0Axx — User detection / Brukergjenkjenning
  0x0A00: { en: 'User detection: factory data write failed', no: 'Brukergjenkjenning: lagring av fabrikkdata feilet' },
  0x0A01: { en: 'User detection: operating data write failed', no: 'Brukergjenkjenning: lagring av driftsdata feilet' },
  // The manual prints this row's code as a second "0A01"; the row itself
  // ("Capteur / Détection permanente") follows the x08 pattern every other
  // module uses, so it is mapped to 0A08 here. Whichever number the device
  // actually reports, both answers are sensible.
  0x0A08: { en: 'User detection: sensor reports permanent presence (seated over 1 h, heavy object on seat/lid, or defective sensor)', no: 'Brukergjenkjenning: sensoren melder konstant tilstedeværelse (sittet over 1 time, tung gjenstand på sete/lokk, eller defekt sensor)' },
  0x0A09: { en: 'User detection: sensor open circuit', no: 'Brukergjenkjenning: brudd i sensoren' },
  0x0A0A: { en: 'User detection: negative weight detected (heavy object on the lid?)', no: 'Brukergjenkjenning: negativ vekt registrert (tung gjenstand på lokket?)' },

  // 0Bxx — Proximity sensor / Nærhetssensor (Mera Comfort)
  0x0B00: { en: 'Proximity sensor: factory data write failed', no: 'Nærhetssensor: lagring av fabrikkdata feilet' },
  0x0B01: { en: 'Proximity sensor: operating data write failed', no: 'Nærhetssensor: lagring av driftsdata feilet' },
  0x0B09: { en: 'Proximity sensor: measurement preparation error', no: 'Nærhetssensor: feil i klargjøringen av måleverdier' },

  // 0Cxx — Orientation light / Orienteringslys (Mera Comfort)
  0x0C00: { en: 'Orientation light: factory data write failed', no: 'Orienteringslys: lagring av fabrikkdata feilet' },
  0x0C01: { en: 'Orientation light: operating data write failed', no: 'Orienteringslys: lagring av driftsdata feilet' },
  0x0C09: { en: 'Orientation light: brightness sensor error', no: 'Orienteringslys: feil i lyssensoren' },

  // 0Dxx — Interface module / Grensesnittmodul
  0x0D00: { en: 'Interface module: factory data write failed', no: 'Grensesnittmodul: lagring av fabrikkdata feilet' },
  0x0D01: { en: 'Interface module: operating data write failed', no: 'Grensesnittmodul: lagring av driftsdata feilet' },
  0x0D08: { en: 'Interface module: 24 V supply missing', no: 'Grensesnittmodul: 24 V-forsyning mangler' },
  0x0D09: { en: 'Interface module: WC control supply has wrong voltage (incompatible or defective WC control)', no: 'Grensesnittmodul: feil spenning til WC-styringen (inkompatibel eller defekt WC-styring)' },
  0x0D0A: { en: 'Interface module: WC control supply overcurrent (possible short circuit)', no: 'Grensesnittmodul: overstrøm til WC-styringen (mulig kortslutning)' },
  0x0D0B: { en: 'Interface module: balance regulator error', no: 'Grensesnittmodul: feil i balanseregulatoren' },
  0x0D0C: { en: 'Interface module: communication with the WC control failed', no: 'Grensesnittmodul: kommunikasjonen med WC-styringen feiler' },

  // 0Exx — Dryer assembly / Tørkerenhet (2020)
  0x0E00: { en: 'Dryer assembly: factory data write failed', no: 'Tørkerenhet: lagring av fabrikkdata feilet' },
  0x0E01: { en: 'Dryer assembly: operating data write failed', no: 'Tørkerenhet: lagring av driftsdata feilet' },
  0x0E08: { en: 'Dryer assembly: 24 V supply missing', no: 'Tørkerenhet: 24 V-forsyning mangler' },
  0x0E09: { en: 'Dryer assembly: 24 V overcurrent', no: 'Tørkerenhet: overstrøm på 24 V' },
  0x0E0A: { en: 'Dryer assembly: 24 V leakage current', no: 'Tørkerenhet: lekkasjestrøm på 24 V' },
  0x0E0B: { en: 'Dryer assembly: dryer arm drive lost its reference (missing/corroded magnet, wiring or blockage)', no: 'Tørkerenhet: tørkerarmens drivverk har mistet referansen (magnet som mangler/er korrodert, kabling eller blokkering)' },
  0x0E0D: { en: 'Dryer assembly: dryer arm drive step loss (blocked, dirty or defective)', no: 'Tørkerenhet: tørkerarmens drivverk mister steg (blokkert, tilsmusset eller defekt)' },

  // 0Fxx — Instantaneous water heater / Gjennomstrømningsvarmer
  0x0F08: { en: 'Instantaneous heater: 230 V supply missing (thermal cutout may have tripped)', no: 'Gjennomstrømningsvarmer: 230 V-forsyning mangler (termosikringen kan ha løst ut)' },
  0x0F09: { en: 'Instantaneous heater: inlet temperature sensor open circuit', no: 'Gjennomstrømningsvarmer: brudd i innløpets temperatursensor' },
  0x0F0A: { en: 'Instantaneous heater: inlet temperature sensor short circuit', no: 'Gjennomstrømningsvarmer: kortslutning i innløpets temperatursensor' },
  0x0F0B: { en: 'Instantaneous heater: outlet temperature sensor open circuit', no: 'Gjennomstrømningsvarmer: brudd i utløpets temperatursensor' },
  0x0F0C: { en: 'Instantaneous heater: outlet temperature sensor short circuit', no: 'Gjennomstrømningsvarmer: kortslutning i utløpets temperatursensor' },
  0x0F0D: { en: 'Instantaneous heater: outlet temperature sensor reports overheating', no: 'Gjennomstrømningsvarmer: utløpets temperatursensor melder overoppheting' },
  0x0F0E: { en: 'Instantaneous heater: temperature regulation error', no: 'Gjennomstrømningsvarmer: feil i temperaturreguleringen' }
});

const NO_ERROR = Object.freeze({ en: 'No error', no: 'Ingen feil' });
const UNKNOWN = Object.freeze({
  en: 'Unknown error — quote this code to Geberit service',
  no: 'Ukjent feil — oppgi denne koden til Geberit service'
});

// The manual's notation: four uppercase hex digits.
const toHex = code => Number(code).toString(16).toUpperCase().padStart(4, '0');

// language: Homey's i18n language string; anything but 'no' falls back to
// English, which mirrors how the rest of the app localizes.
const formatErrorCode = (code, language) => {
  const lang = language === 'no' ? 'no' : 'en';
  const value = Number(code);

  if (!Number.isFinite(value)) return null;
  if (value === 0) return { hex: '0000', description: NO_ERROR[lang], text: NO_ERROR[lang] };

  const entry = CODES[value];
  const hex = toHex(value);
  const description = entry ? entry[lang] : UNKNOWN[lang];
  return { hex, description, text: `${hex} — ${description}` };
};

module.exports = { CODES, formatErrorCode, toHex };
