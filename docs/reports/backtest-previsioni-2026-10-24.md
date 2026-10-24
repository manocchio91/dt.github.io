# Backtest delle previsioni — 2026-10-24

**Protocollo.** Walk-forward con origini giornaliere; storico minimo 14 giorni, contesto 28 giorni; covariate note: solo calendario; nessun dato successivo all’origine nell’input.

**Dati.** Rianalisi Open-Meteo (ERA5/ERA5-Land, CC BY 4.0): stime da modello su cella di griglia, non misure in campo.

Nota: per serie molto lisce (umidità del suolo) l’errore della persistenza stagionale sullo storico è minimo, quindi il MASE risulta molto alto anche con MAE piccolo: per confrontare i modelli su queste serie usare MAE, WQL e copertura.

Metriche: MAE della mediana (unità della variabile), MASE (rispetto all’errore della persistenza a un passo sullo storico iniziale), pinball medio e WQL sui 21 quantili, copertura empirica degli intervalli 80% (q0,10–q0,90) e 98% (q0,01–q0,99), confusione degli avvisi rispetto alla soglia dimostrativa.

## Campobasso — temperatura dell’aria, orizzonte 24 h

Contesto: **urbano** · variabile `temperatura_aria` (°C) · periodo 2025-06-01 → 2025-08-31 · soglia dimostrativa di caldo intenso (32 °C).

| Modello | Origini | MAE | MASE | Pinball medio | WQL | Copertura 80% | Copertura 98% | Veri positivi | Falsi allarmi | Criticità mancate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Persistenza (ultimo valore) | 78 | 4,667 | 5,832 | 1,486 | 0,131 | 0,863 | 0,979 | 0 | 0 | 19 |
| Persistenza stagionale (stessa ora del giorno prima) | 78 | 1,734 | 2,166 | 0,614 | 0,054 | 0,752 | 0,946 | 16 | 11 | 3 |
| mistralai/Timestral-5M | non eseguito | Motore Timestral non configurato (servizio non disponibile in questo ambiente) | | | | | | | | |
| mistralai/Timestral-28M | non eseguito | Motore Timestral non configurato (servizio non disponibile in questo ambiente) | | | | | | | | |

## Vigneto molisano — umidità del suolo 7–28 cm, orizzonte 72 h

Contesto: **agricolo** · variabile `umidita_suolo` (m³/m³) · periodo 2025-06-01 → 2025-09-15 · soglia dimostrativa di umidità bassa (0,16 m³/m³), da sostituire con quella dell’agronomo.

| Modello | Origini | MAE | MASE | Pinball medio | WQL | Copertura 80% | Copertura 98% | Veri positivi | Falsi allarmi | Criticità mancate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Persistenza (ultimo valore) | 91 | 0,004 | 22,951 | 0,002 | 0,02 | 0,739 | 0,895 | 66 | 0 | 8 |
| Persistenza stagionale (stessa ora del giorno prima) | 91 | 0,006 | 36,735 | 0,002 | 0,03 | 0,715 | 0,86 | 71 | 3 | 3 |
| mistralai/Timestral-5M | non eseguito | Motore Timestral non configurato (servizio non disponibile in questo ambiente) | | | | | | | | |
| mistralai/Timestral-28M | non eseguito | Motore Timestral non configurato (servizio non disponibile in questo ambiente) | | | | | | | | |

## Vigneto molisano — temperatura dell’aria, orizzonte 48 h

Contesto: **agricolo** · variabile `temperatura_aria` (°C) · periodo 2025-06-01 → 2025-09-15 · soglia dimostrativa di stress termico (35 °C).

| Modello | Origini | MAE | MASE | Pinball medio | WQL | Copertura 80% | Copertura 98% | Veri positivi | Falsi allarmi | Criticità mancate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Persistenza (ultimo valore) | 92 | 4,081 | 3,193 | 1,301 | 0,108 | 0,862 | 0,982 | 0 | 0 | 9 |
| Persistenza stagionale (stessa ora del giorno prima) | 92 | 2,425 | 1,897 | 0,847 | 0,07 | 0,756 | 0,957 | 6 | 12 | 3 |
| mistralai/Timestral-5M | non eseguito | Motore Timestral non configurato (servizio non disponibile in questo ambiente) | | | | | | | | |
| mistralai/Timestral-28M | non eseguito | Motore Timestral non configurato (servizio non disponibile in questo ambiente) | | | | | | | | |

## Esito

Timestral **non è stato eseguito**: resta **Beta da validare**. Le baseline sono il riferimento minimo che un modello deve superare. I benchmark pubblici di Mistral non sono usati come prova di efficacia sul Molise.
