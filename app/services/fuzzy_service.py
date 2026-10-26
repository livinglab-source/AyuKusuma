"""
Logika Fuzzy Sugeno untuk evaluasi kualitas air & rekomendasi pakan kolam ADM.
"""


def hitung_status_fuzzy(suhu: float, do_air: float, ph: float, tds: float):
    def trapesium(x, a, b, c, d):
        if x <= a: return 1.0 if a == b else 0.0
        if x >= d: return 1.0 if c == d else 0.0
        if a < x < b: return (x - a) / (b - a)
        if b <= x <= c: return 1.0
        if c < x < d: return (d - x) / (d - c)
        return 0.0

    def get_label(mu):
        if mu[2] > mu[1] and mu[2] > mu[0]: return "Tinggi"
        if mu[1] >= mu[0] and mu[1] >= mu[2]: return "Normal"
        return "Rendah"

    mu_suhu = [trapesium(suhu, 0, 0, 24, 26), trapesium(suhu, 24, 26, 30, 32), trapesium(suhu, 30, 32, 40, 40)]
    mu_do   = [trapesium(do_air, 0, 0, 3, 5), trapesium(do_air, 4, 5, 7, 8), trapesium(do_air, 7, 8, 12, 12)]
    mu_ph   = [trapesium(ph, 0, 0, 6.5, 7.0), trapesium(ph, 6.5, 7.0, 8.0, 8.5), trapesium(ph, 8.0, 8.5, 14, 14)]
    mu_tds  = [trapesium(tds, 0, 0, 400, 500), trapesium(tds, 400, 500, 1000, 1500), trapesium(tds, 1000, 1500, 1500, 2000)]

    Z1, Z2, Z3, Z4 = 0.5, 1.0, 1.5, 2.0
    RULE_BASE = [
      [ [ [Z1,Z1,Z1], [Z1,Z2,Z1], [Z1,Z1,Z1] ], [ [Z1,Z2,Z1], [Z2,Z3,Z2], [Z1,Z2,Z1] ], [ [Z1,Z1,Z1], [Z1,Z2,Z1], [Z1,Z1,Z1] ] ],
      [ [ [Z1,Z2,Z1], [Z2,Z3,Z2], [Z1,Z2,Z1] ], [ [Z2,Z3,Z2], [Z3,Z4,Z3], [Z2,Z3,Z2] ], [ [Z1,Z2,Z1], [Z2,Z4,Z2], [Z1,Z2,Z1] ] ],
      [ [ [Z1,Z1,Z1], [Z1,Z2,Z1], [Z1,Z1,Z1] ], [ [Z1,Z2,Z1], [Z2,Z3,Z2], [Z1,Z2,Z1] ], [ [Z1,Z1,Z1], [Z1,Z2,Z1], [Z1,Z1,Z1] ] ]
    ]

    pembilang, penyebut = 0.0, 0.0
    rules_aktif = []
    for i_s in range(3):
        for i_d in range(3):
            for i_p in range(3):
                for i_t in range(3):
                    alpha = min(mu_suhu[i_s], mu_do[i_d], mu_ph[i_p], mu_tds[i_t])
                    if alpha > 0:
                        pembilang += alpha * RULE_BASE[i_s][i_d][i_p][i_t]
                        penyebut += alpha
                        rules_aktif.append(str(1 + (i_s * 27) + (i_d * 9) + (i_p * 3) + i_t))

    target_persen = 0.0 if penyebut == 0 else (pembilang / penyebut)
    pakan_gram = (target_persen / 100.0) * (3.132 * 1000.0)

    return {
        "rule_aktif": ", ".join(rules_aktif) if rules_aktif else "-",
        "pakan_gram": round(pakan_gram, 1),
        "lbl_suhu": get_label(mu_suhu),
        "lbl_do": get_label(mu_do),
        "lbl_ph": get_label(mu_ph),
        "lbl_tds": get_label(mu_tds)
    }
