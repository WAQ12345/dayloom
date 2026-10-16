"""Create an app-specific signing key. Passwords never appear in argv or stdout."""
from pathlib import Path
import os,secrets,subprocess,shutil
root=Path(__file__).resolve().parents[1]
folder=root/'artifacts/signing'; backup=root/'artifacts/signing-backup'
folder.mkdir(parents=True,exist_ok=True); folder.chmod(0o700)
envfile=folder/'release.env'; key=folder/'daily-life-release.jks'
if envfile.exists() and key.exists():
    print('Existing Dayloom signing identity retained.')
elif envfile.exists() or key.exists():
    raise SystemExit('Partial signing identity exists; inspect it rather than replacing it.')
else:
    password=secrets.token_hex(32); env=dict(os.environ,DAILY_SIGNING_PASSWORD=password)
    subprocess.run([str(root/'scripts/with-local-env.sh'),'keytool','-genkeypair','-keystore',str(key),'-storetype','PKCS12','-storepass:env','DAILY_SIGNING_PASSWORD','-keypass:env','DAILY_SIGNING_PASSWORD','-alias','daily-life','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Dayloom Local, OU=Personal, O=Dayloom, C=CN'],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    key.chmod(0o600)
    with envfile.open('x') as f:
        f.write(f"export DAILY_SIGNING_STORE='{key}'\nexport DAILY_SIGNING_ALIAS='daily-life'\nexport DAILY_SIGNING_PASSWORD='{password}'\n")
    envfile.chmod(0o600)
    backup.mkdir(parents=True,exist_ok=True);backup.chmod(0o700)
    shutil.copy2(key,backup/key.name);shutil.copy2(envfile,backup/envfile.name)
    print('Created app-specific signing identity and local backup under ignored artifacts/.')
