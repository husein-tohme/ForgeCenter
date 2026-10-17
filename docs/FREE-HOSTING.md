# Put ForgeCenter online for $0

A free server from Oracle Cloud, a free address from DuckDNS, and a free HTTPS padlock. About 20 minutes, most of it waiting.

What it costs: nothing. Oracle asks for a card when you sign up to check you're a real person; the "Always Free" server below never charges it.

## 1. Get your free address (DuckDNS)

1. Go to [duckdns.org](https://www.duckdns.org) and sign in with GitHub or Google.
2. Type a name (for example `forgecenter`) and press **add domain**. Your address is now `forgecenter.duckdns.org`.
3. Keep the page open: you'll need the **token** shown at the top.

## 2. Get your free server (Oracle Cloud)

1. Sign up at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). Pick the home region closest to you (it can't be changed later).
2. In the console, open **Compute → Instances → Create instance**.
3. **Image:** Canonical Ubuntu 24.04. **Shape:** Ampere `VM.Standard.A1.Flex` with 2 OCPUs and 12 GB memory (marked "Always Free eligible"). If that shape is out of capacity, use `VM.Standard.E2.1.Micro`, which is also free.
4. Under **Add SSH keys**, choose **Generate a key pair for me** and download the private key.
5. Press **Create** and wait until it says **Running**. Copy its **Public IP address**.

## 3. Open the web ports

On the instance page, click the **subnet** link, then the **Default Security List**, then **Add Ingress Rules**:

- Source CIDR `0.0.0.0/0`, IP protocol **TCP**, destination port range `80,443`, then **Add Ingress Rules**.

## 4. Run the setup command

1. In the Oracle console, open **Cloud Shell** (the `>_` icon at the top right).
2. Upload the private key you downloaded (Cloud Shell menu → **Upload**), then connect (put in your server's IP):
   ```
   chmod 600 ssh-key-*.key
   ssh -i ssh-key-*.key ubuntu@YOUR_SERVER_IP
   ```
3. Paste this and press Enter:
   ```
   curl -fsSL https://raw.githubusercontent.com/husein-tohme/ForgeCenter/main/scripts/free-host.sh -o free-host.sh && sudo bash free-host.sh
   ```
4. It asks for your DuckDNS name, your DuckDNS token and your email, then sets everything up. When it finishes it prints your address.

## 5. Make yourself the owner

Open `https://yourname.duckdns.org`. Sign in with the email you typed in step 4 to get the owner panel. If no sign-in buttons show yet, the script printed an **Owner setup** code: open `/setup` on your site and enter it.

Then open `/sign-in-setup` (owner only): it lists every sign-in option with the exact link to paste into Google, GitHub, Microsoft and Discord, all free. Steam sign-in works without any setup.

## Adding keys and updating

- Settings live in `/opt/forgecenter/.env` on the server (`sudo nano /opt/forgecenter/.env`). After changing them, run `sudo bash free-host.sh` again.
- The same command also updates the site to the newest code. Accounts and orders are kept in a Docker volume.
- Free extras: Stripe has no monthly fee, Resend sends 3,000 emails a month free. The AI features need a paid Anthropic key; leave `ANTHROPIC_API_KEY` empty and they simply stay off.
