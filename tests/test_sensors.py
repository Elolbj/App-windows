"""Tests des capteurs (LibreHardwareMonitor, compteurs GPU), réglages et règles « persistance »."""

import pytest

from pcinsight import analysis
from pcinsight.collectors.counters import gpu_summary
from pcinsight.collectors.network import parse_netsh_wlan
from pcinsight.collectors.sensors import key_values, parse_lhm
from pcinsight.settings import MemorySettings

LHM_SAMPLE = {
    "id": 0, "Version": "0.9.6", "Text": "Sensor", "Children": [{
        "id": 1, "Text": "PC", "Children": [
            {"id": 2, "Text": "AMD Ryzen 7 7800X3D", "HardwareId": "/amdcpu/0", "ImageURL": "images_icon/cpu.png",
             "Children": [
                 {"id": 3, "Text": "Temperatures", "Children": [
                     {"id": 4, "Text": "Core (Tctl/Tdie)", "SensorId": "/amdcpu/0/temperature/2", "Type": "Temperature",
                      "Value": "61,5 °C", "Min": "40,0 °C", "Max": "80,0 °C", "RawValue": 61.5, "RawMin": 40.0, "RawMax": 80.0,
                      "Children": []}]},
                 {"id": 5, "Text": "Powers", "Children": [
                     {"id": 6, "Text": "Package", "SensorId": "/amdcpu/0/power/0", "Type": "Power",
                      "Value": "55.2 W", "Min": "", "Max": "", "Children": []}]}]},
            {"id": 7, "Text": "NVIDIA GeForce RTX 4070", "HardwareId": "/gpu-nvidia/0", "ImageURL": "images_icon/nvidia.png",
             "Children": [{"id": 8, "Text": "Temperatures", "Children": [
                 {"id": 9, "Text": "GPU Core", "SensorId": "/gpu-nvidia/0/temperature/0", "Type": "Temperature",
                  "RawValue": 48.0, "Children": []}]}]},
            {"id": 10, "Text": "Nuvoton NCT6798D", "HardwareId": "/lpc/nct6798d/0", "ImageURL": "images_icon/chip.png",
             "Children": [{"id": 11, "Text": "Fans", "Children": [
                 {"id": 12, "Text": "Fan #2", "SensorId": "/lpc/nct6798d/0/fan/1", "Type": "Fan", "RawValue": 1180.0,
                  "Children": []}]}]},
        ]}],
}


def test_parse_lhm_raw_and_formatted_values():
    data = parse_lhm(LHM_SAMPLE)
    assert data["version"] == "0.9.6"
    kinds = {h["name"]: h["kind"] for h in data["hardware"]}
    assert kinds == {"AMD Ryzen 7 7800X3D": "cpu", "NVIDIA GeForce RTX 4070": "gpu", "Nuvoton NCT6798D": "board"}
    temp = next(s for s in data["sensors"] if s["id"] == "/amdcpu/0/temperature/2")
    assert (temp["value"], temp["min"], temp["max"], temp["unit"]) == (61.5, 40.0, 80.0, "°C")
    power = next(s for s in data["sensors"] if s["type"] == "Power")
    assert power["value"] == 55.2  # pas de valeur brute : lecture du texte formaté


def test_key_values_priorities():
    lhm = parse_lhm(LHM_SAMPLE)
    nvidia = [{"temp": 50.0, "power": 120.0, "fan": 40.0, "load": 33.0}]
    k = key_values(lhm, nvidia, {"gpu": 31.0, "thermal": [{"name": "TZ0", "temp": 27.8}]})
    assert k["cpu_temp"] == {"value": 61.5, "source": "LibreHardwareMonitor"}  # LHM prioritaire sur ACPI
    assert k["gpu_temp"]["source"] == "nvidia-smi"
    assert k["gpu_load"]["source"] == "Compteurs Windows"
    assert k["fan_max"]["value"] == 1180.0
    only_acpi = key_values(None, [], {"thermal": [{"name": "TZ0", "temp": 45.0}]})
    assert "ACPI" in only_acpi["cpu_temp"]["source"]


def test_gpu_summary_takes_busiest_engine():
    engines = {
        "pid_10_luid_0x00000000_0x0000D1B2_phys_0_eng_0_engtype_3D": 30.0,
        "pid_20_luid_0x00000000_0x0000D1B2_phys_0_eng_0_engtype_3D": 25.0,
        "pid_20_luid_0x00000000_0x0000D1B2_phys_0_eng_3_engtype_VideoDecode": 12.0,
        "pid_30_luid_0x00000000_0x0000AAAA_phys_0_eng_0_engtype_3D": 5.0,
    }
    dedicated = {"luid_0x00000000_0x0000D1B2_phys_0": 3e9, "luid_0x00000000_0x0000AAAA_phys_0": 1e8}
    out = gpu_summary(engines, dedicated, {})
    assert out["gpu"] == 55.0                         # 30 + 25 sur le moteur 3D
    assert out["gpus"][0]["luid"] == "0x00000000_0x0000d1b2"
    assert out["gpus"][0]["engines"]["Décodage vidéo"] == 12.0
    assert out["gpu_mem"] == 3e9
    assert gpu_summary({}, {}, {}) == {}


def test_settings_validation():
    s = MemorySettings()
    assert s.update({"lhm_port": "8090"})["lhm_port"] == 8090
    with pytest.raises(ValueError):
        s.update({"lhm_port": 80})
    assert "inconnu" not in s.update({"inconnu": 1})


def test_netsh_english():
    text = "    SSID                   : Home\n    Radio type             : 802.11ac\n    Channel                : 44\n" \
           "    Receive rate (Mbps)    : 866.7\n    Signal                 : 71%\n"
    w = parse_netsh_wlan(text)
    assert w["ssid"] == "Home" and w["radio"] == "802.11ac" and w["rx_rate"] == 866.7 and w["signal"] == 71
    assert parse_netsh_wlan("aucune interface") is None


def test_persistence_rules():
    software = {
        "tasks": [
            {"name": "Updater", "actions": [r"C:\Users\x\AppData\Local\Temp\upd.exe /s"], "runAs": "x", "elevated": False},
            {"name": "Elevated", "actions": [r"%LOCALAPPDATA%\Tool\tool.exe"], "runAs": "SYSTEM", "elevated": True},
            {"name": "Legit", "actions": [r"C:\Program Files\Vendor\agent.exe"], "runAs": "SYSTEM", "elevated": True},
        ],
        "startup": [{"name": "Bad", "command": r"C:\Users\Public\run.exe", "enabled": True}],
        "services": [{"display_name": "Svc", "binpath": r"C:\Users\x\AppData\Roaming\svc.exe", "third_party": True}],
    }
    security = {"hosts": [{"ip": "10.0.0.5", "names": ["www.banque.fr"]}, {"ip": "127.0.0.1", "names": ["localhost"]}]}
    drivers = {"drivers": [{"device": "Driver X", "signed": False}]}
    titles = [f["title"] for f in analysis.analyze({"software": software, "security": security, "drivers": drivers})["findings"]]
    assert "Tâche planifiée suspecte : Updater" in titles
    assert "Tâche planifiée suspecte : Elevated" in titles
    assert "Tâche planifiée suspecte : Legit" not in titles
    assert "Programme au démarrage suspect : Bad" in titles
    assert any(t.startswith("Service lancé depuis un dossier utilisateur") for t in titles)
    assert "1 pilote(s) non signé(s)" in titles
    assert "Redirections dans le fichier hosts" in titles


def test_temperature_rules():
    res = analysis.analyze({"sensors": {"cpu_temp": {"value": 96, "source": "LibreHardwareMonitor"},
                                        "gpu_temp": {"value": 70, "source": "nvidia-smi"}}})
    titles = [f["title"] for f in res["findings"]]
    assert "Processeur très chaud" in titles and "Carte graphique très chaude" not in titles
    # une zone ACPI approximative ne déclenche pas d'alerte
    res = analysis.analyze({"sensors": {"cpu_temp": {"value": 96, "source": "Zone thermique ACPI (approximatif)"}}})
    assert not res["findings"]
