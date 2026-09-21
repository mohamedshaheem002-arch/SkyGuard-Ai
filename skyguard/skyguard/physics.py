"""Atmospheric physics helpers (vectorised)."""
from __future__ import annotations
import numpy as np

# Magnus formula constants (Alduchov & Eskridge 1996) - accurate to <0.1 °C over -40..50 °C
_A, _B, _C = 17.625, 243.04, 6.1094


def sat_vapour_pressure(t_c):
    t_c = np.asarray(t_c, dtype=float)
    return _C * np.exp(_A * t_c / (_B + t_c))


def dew_point(t_c, rh):
    """Dew point in °C from temperature and RH (%). NaN-safe."""
    t_c = np.asarray(t_c, dtype=float)
    rh = np.clip(np.asarray(rh, dtype=float), 0.5, 100.0)
    gamma = np.log(rh / 100.0) + _A * t_c / (_B + t_c)
    return _B * gamma / (_A - gamma)


def rh_from_dewpoint(t_c, td_c):
    t_c = np.asarray(t_c, dtype=float); td_c = np.asarray(td_c, dtype=float)
    return np.clip(100.0 * sat_vapour_pressure(td_c) / sat_vapour_pressure(t_c), 0.0, 100.0)


def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    dlat = lat2 - lat1; dlon = lon2 - lon1
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    return 6371.0 * 2 * np.arcsin(np.sqrt(a))


def lapse_adjust_temp(t_c, from_elev_m, to_elev_m, lapse=0.0065):
    """Adjust temperature between elevations with standard lapse rate (used only as a prior)."""
    return t_c - lapse * (to_elev_m - from_elev_m)
