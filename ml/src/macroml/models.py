"""Small deterministic models and scoring rules, in plain numpy.

fit_logit is L2-regularised logistic regression via IRLS (Newton) — no random
seeds, no solver dependencies, converges in a handful of iterations on the
few-hundred-row monthly datasets this project sees. The ridge term keeps early
walk-forward windows (few positive labels, near-separable) well behaved.
"""

from __future__ import annotations

import numpy as np


def standardize(X: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Column-wise (X - mu) / sd with sd floored at tiny; returns (Xs, mu, sd)."""
    mu = X.mean(axis=0)
    sd = X.std(axis=0)
    sd = np.where(sd < 1e-12, 1.0, sd)
    return (X - mu) / sd, mu, sd


def fit_logit(X: np.ndarray, y: np.ndarray, l2: float = 1.0) -> np.ndarray:
    """Ridge logistic regression. X: (n, k) standardized features WITHOUT an
    intercept column (one is prepended, unpenalized). Returns beta of len k+1
    with beta[0] = intercept."""
    n, k = X.shape
    Xb = np.column_stack([np.ones(n), X])
    beta = np.zeros(k + 1)
    pen = np.full(k + 1, l2)
    pen[0] = 0.0
    for _ in range(100):
        p = 1.0 / (1.0 + np.exp(-(Xb @ beta)))
        w = np.clip(p * (1.0 - p), 1e-10, None)
        grad = Xb.T @ (y - p) - pen * beta
        hess = (Xb.T * w) @ Xb + np.diag(pen + 1e-9)
        step = np.linalg.solve(hess, grad)
        beta += step
        if np.max(np.abs(step)) < 1e-9:
            break
    return beta


def predict_logit(beta: np.ndarray, x: np.ndarray) -> float:
    """P(y=1) for a single standardized feature row."""
    return float(1.0 / (1.0 + np.exp(-(beta[0] + x @ beta[1:]))))


def auc(y: np.ndarray, p: np.ndarray) -> float:
    """Rank-based AUC (Mann-Whitney), average ranks on ties."""
    order = np.argsort(p, kind="stable")
    ranks = np.empty(len(p))
    ranks[order] = np.arange(1, len(p) + 1)
    # average ranks within tied groups
    for v in np.unique(p):
        mask = p == v
        if mask.sum() > 1:
            ranks[mask] = ranks[mask].mean()
    pos = y == 1
    n1, n0 = pos.sum(), (~pos).sum()
    if n1 == 0 or n0 == 0:
        return float("nan")
    return float((ranks[pos].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def brier(y: np.ndarray, p: np.ndarray) -> float:
    return float(np.mean((p - y) ** 2))


def log_loss(y: np.ndarray, p: np.ndarray) -> float:
    q = np.clip(p, 1e-9, 1 - 1e-9)
    return float(-np.mean(y * np.log(q) + (1 - y) * np.log(1 - q)))
