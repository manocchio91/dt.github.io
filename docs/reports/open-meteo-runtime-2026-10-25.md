# Runtime Open-Meteo → Supabase — verifica reale 2026-10-25

- Ambiente: progetto di TEST su `****.supabase.co` (riferimento oscurato); Edge Function `open-meteo-ingest`; Open-Meteo Forecast API reale
- Dati temporanei: prefisso `MDT_RUNTIME_TEST_20261025162835` (eliminati a fine verifica con `cleanup`)
- Esito: 22 superati, 0 falliti

| ID | Controllo | Esito | Evidenza |
|---|---|---|---|
| R-urbano | Acquisizione manuale reale (urbano) dall’editor via Edge Function | ✔ | 79 ore, 205 osservazioni, emissione 2026-10-25T16:00:00.000Z, cella 41.586098/14.661439 quota 700 m |
| R-agricolo | Acquisizione manuale reale (agricolo) dall’editor via Edge Function | ✔ | 79 ore, 287 osservazioni, emissione 2026-10-25T16:00:00.000Z, cella 41.80364/14.905517 quota 427 m |
| D-urbano-run | Acquisizione registrata (urbano): stato, emissione, validità, cella, quota, fonte | ✔ | 79 ore da 2026-10-25T16:00:00+00:00 a 2026-10-28T22:00:00+00:00; richiesta 41.5603/14.6627 → cella 41.586098/14.661439, quota 700 m; modello richiesto best_match, restituito non dichiarato da Open-Meteo |
| D-urbano-orari | Ore future consecutive, issued_at fisso, fonte open_meteo (urbano) | ✔ | 79 ore consecutive, issued_at 2026-10-25T16:00:00+00:00 |
| D-urbano-variabili | Variabili presenti e plausibili (urbano) | ✔ | temperature_2m 5.80…15.90 (79/79); relative_humidity_2m 47.00…91.00 (79/79); apparent_temperature 3.10…13.50 (79/79); precipitation 0.00…0.10 (79/79); precipitation_probability 0.00…0.00 (79/79); wind_speed_10m 0.58…7.41 (79/79); wind_gusts_10m 2.00…16.20 (79/79); wind_direction_10m 3.00…360.00 (79/79); shortwave_radiation 0.00…562.00 (79/79) |
| D-urbano-unita | Unità registrate (urbano) | ✔ | precipitation=mm, temperature_2m=°C, wind_gusts_10m=m/s, wind_speed_10m=m/s, wind_direction_10m=°, shortwave_radiation=W/m², apparent_temperature=°C, relative_humidity_2m=%, precipitation_probability=% |
| D-urbano-osservazioni | Ore passate registrate come analisi modellata (urbano) | ✔ | 205 valori, fonte open_meteo, flag “modellato” |
| D-agricolo-run | Acquisizione registrata (agricolo): stato, emissione, validità, cella, quota, fonte | ✔ | 79 ore da 2026-10-25T16:00:00+00:00 a 2026-10-28T22:00:00+00:00; richiesta 41.8/14.92 → cella 41.80364/14.905517, quota 427 m; modello richiesto best_match, restituito non dichiarato da Open-Meteo |
| D-agricolo-orari | Ore future consecutive, issued_at fisso, fonte open_meteo (agricolo) | ✔ | 79 ore consecutive, issued_at 2026-10-25T16:00:00+00:00 |
| D-agricolo-variabili | Variabili presenti e plausibili (agricolo) | ✔ | temperature_2m 9.20…17.20 (79/79); relative_humidity_2m 48.00…88.00 (79/79); apparent_temperature 6.40…14.90 (79/79); precipitation 0.00…0.20 (79/79); precipitation_probability 0.00…3.00 (79/79); wind_speed_10m 0.20…7.56 (79/79); wind_gusts_10m 0.70…13.90 (79/79); wind_direction_10m 2.00…360.00 (79/79); shortwave_radiation 0.00…544.00 (79/79); et0_fao_evapotranspiration 0.00…0.31 (79/79); vapour_pressure_deficit 0.19…0.94 (79/79); soil_temperature_0cm 7.50…20.50 (79/79); soil_temperature_6cm 9.50…17.30 (79/79); soil_temperature_18cm 12.50…14.90 (79/79); soil_temperature_54cm 16.20…17.20 (79/79); soil_moisture_0_to_1cm 0.19…0.24 (79/79); soil_moisture_1_to_3cm 0.19…0.24 (79/79); soil_moisture_3_to_9cm 0.20…0.25 (79/79); soil_moisture_9_to_27cm 0.21…0.21 (79/79); soil_moisture_27_to_81cm 0.19…0.19 (79/79) |
| D-agricolo-unita | Unità registrate (agricolo) | ✔ | precipitation=mm, temperature_2m=°C, wind_gusts_10m=m/s, wind_speed_10m=m/s, wind_direction_10m=°, shortwave_radiation=W/m², apparent_temperature=°C, relative_humidity_2m=%, soil_temperature_0cm=°C, soil_temperature_6cm=°C, soil_temperature_18cm=°C, soil_temperature_54cm=°C, soil_moisture_0_to_1cm=m³/m³, soil_moisture_1_to_3cm=m³/m³, soil_moisture_3_to_9cm=m³/m³, soil_moisture_9_to_27cm=m³/m³, vapour_pressure_deficit=kPa, soil_moisture_27_to_81cm=m³/m³, precipitation_probability=%, et0_fao_evapotranspiration=mm |
| D-agricolo-osservazioni | Ore passate registrate come analisi modellata (agricolo) | ✔ | 287 valori, fonte open_meteo, flag “modellato” |
| I1 | Idempotenza: stessa ora rieseguita dal job → già acquisita, nessun duplicato | ✔ | urbano 79 punti, 1 acquisizione; agricolo 79 punti, 1 acquisizione |
| I2 | Job pianificato su tutte le località attive: la località inattiva è esclusa | ✔ | 2 località attive, entrambe già acquisite; inattiva: 0 acquisizioni |
| I3 | Località inattiva richiesta esplicitamente → 409, nessuna acquisizione | ✔ | Località disattivata |
| L1 | Limite manuale: secondo aggiornamento dell’editor entro 10 minuti → 429 | ✔ | 429 |
| P1 | Ruoli: il lettore non può chiedere un aggiornamento (403) | ✔ | 403 |
| P2 | Isolamento: un’altra organizzazione non vede né aggiorna (404, 0 righe) | ✔ | esterno: 404 e 0 righe in 4 tabelle; lettore: 79 righe |
| P3 | Nessun client registra dati con fonte Open-Meteo | ✔ | osservazione, previsione, acquisizione e funzione di servizio rifiutate |
| P4 | Previsioni registrate immutabili (anche per il ruolo di servizio) | ✔ | Le previsioni registrate non si sovrascrivono. |
| E1 | Errore simulato: un tentativo fallito non tocca i dati validi | ✔ | acquisizione fallita registrata (SIMULATO); 79 previsioni intatte, ultima acquisizione valida ancora “completata” |
| T1 | Nessuna previsione Timestral creata | ✔ | 0 righe in forecast_runs |

Nessuna credenziale è riportata in questo file.
