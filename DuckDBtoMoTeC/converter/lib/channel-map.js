// { motecName, shortName, duckdbTable, unit, scale, isEvent, wheels }
// scale: multiply DuckDB value by this to convert units
// wheels: table has value1-4 (FL/FR/RL/RR), expanded to 4 MoTeC channels
// isEvent: table is in eventsList (has ts column), step-hold interpolated to 10 Hz
const CHANNELS = [
  { motecName: 'Engine RPM',       shortName: 'RPM',  duckdbTable: 'Engine RPM',        unit: 'rpm',  scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Throttle Pos',     shortName: 'Thr',  duckdbTable: 'Throttle Pos',      unit: '%',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Brake Pos',        shortName: 'Brk',  duckdbTable: 'Brake Pos',         unit: '%',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Steering Pos',     shortName: 'Str',  duckdbTable: 'Steering Pos',      unit: '%',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Ground Speed',     shortName: 'Spd',  duckdbTable: 'Ground Speed',      unit: 'km/h', scale: 1,    isEvent: false, wheels: false },
  { motecName: 'G Force Lat',      shortName: 'GLat', duckdbTable: 'G Force Lat',       unit: 'G',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'G Force Long',     shortName: 'GLng', duckdbTable: 'G Force Long',      unit: 'G',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'G Force Vert',     shortName: 'GVrt', duckdbTable: 'G Force Vert',      unit: 'G',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Fuel Level',       shortName: 'Fuel', duckdbTable: 'Fuel Level',        unit: 'l',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Water Temp',       shortName: 'WTmp', duckdbTable: 'Engine Water Temp', unit: 'C',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Oil Temp',         shortName: 'OTmp', duckdbTable: 'Engine Oil Temp',   unit: 'C',    scale: 1,    isEvent: false, wheels: false },
  { motecName: 'GPS Lat',          shortName: 'Lat',  duckdbTable: 'GPS Latitude',      unit: 'deg',  scale: 1,    isEvent: false, wheels: false },
  { motecName: 'GPS Lon',          shortName: 'Lon',  duckdbTable: 'GPS Longitude',     unit: 'deg',  scale: 1,    isEvent: false, wheels: false },
  { motecName: 'Susp Pos',         shortName: 'SPos', duckdbTable: 'Susp Pos',          unit: 'mm',   scale: 1000, isEvent: false, wheels: true  },
  { motecName: 'Ride Height',      shortName: 'RHgt', duckdbTable: 'RideHeights',       unit: 'mm',   scale: 1000, isEvent: false, wheels: true  },
  { motecName: 'Wheel Speed',      shortName: 'WSpd', duckdbTable: 'Wheel Speed',       unit: 'km/h', scale: 3.6,  isEvent: false, wheels: true  },
  { motecName: 'Brake Temp',       shortName: 'BrkT', duckdbTable: 'Brakes Temp',       unit: 'C',    scale: 1,    isEvent: false, wheels: true  },
  { motecName: 'Tyre Temp Inner',  shortName: 'TTIn', duckdbTable: 'TyresTempLeft',     unit: 'C',    scale: 1,    isEvent: false, wheels: true  },
  { motecName: 'Tyre Temp Mid',    shortName: 'TTMd', duckdbTable: 'TyresTempCentre',   unit: 'C',    scale: 1,    isEvent: false, wheels: true  },
  { motecName: 'Tyre Temp Outer',  shortName: 'TTOt', duckdbTable: 'TyresTempRight',    unit: 'C',    scale: 1,    isEvent: false, wheels: true  },
  { motecName: 'Tyre Pressure',    shortName: 'TyrP', duckdbTable: 'TyresPressure',     unit: 'kPa',  scale: 1,    isEvent: false, wheels: true  },
  { motecName: 'Tyre Wear',        shortName: 'TWr',  duckdbTable: 'Tyres Wear',        unit: '%',    scale: 1,    isEvent: false, wheels: true  },
  { motecName: 'Gear',             shortName: 'Gear', duckdbTable: 'Gear',              unit: '',     scale: 1,    isEvent: true,  wheels: false },
  { motecName: 'TC',               shortName: 'TC',   duckdbTable: 'TC',                unit: '',     scale: 1,    isEvent: true,  wheels: false },
  { motecName: 'ABS',              shortName: 'ABS',  duckdbTable: 'ABS',               unit: '',     scale: 1,    isEvent: true,  wheels: false },
  { motecName: 'In Pits',          shortName: 'Pits', duckdbTable: 'In Pits',           unit: '',     scale: 1,    isEvent: true,  wheels: false },
  { motecName: 'Speed Limiter',    shortName: 'SpdL', duckdbTable: 'Speed Limiter',     unit: '',     scale: 1,    isEvent: true,  wheels: false },
];

module.exports = { CHANNELS };
