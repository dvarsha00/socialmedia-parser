const { app, BrowserWindow, ipcMain } = require("electron");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: __dirname + "/preload.js", // Ensure this is the correct path to your preload script
    },
  });

  mainWindow.loadFile("index.html");
}

class InstagramBot {
  constructor(username, password, sendLog) {
    this.username = username;
    this.password = password;
    this.sendLog = sendLog; // Function to send logs
  }

  async init() {
    this.browser = await puppeteer.launch({ headless: true });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1920, height: 1080 });
  }

  async login() {
    this.sendLog("Navigating to login page...");
    await this.page.goto("https://www.instagram.com/accounts/login/", {
      waitUntil: "networkidle2",
    });
    await this.page.type('input[name="username"]', this.username, { delay: 100 });
    await this.page.type('input[name="password"]', this.password, { delay: 100 });
    await this.page.click('button[type="submit"]');

    await this.page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {});

    const twoFactorPrompt = await this.page.$('input[name="verificationCode"]');
    if (twoFactorPrompt) {
      this.sendLog("2FA code required. Please enter the 2FA code.");
      const code = await this.waitForTwoFactorCode(); // Implement this method to get the 2FA code from the user

      await this.page.type('input[name="verificationCode"]', code, { delay: 100 });
      await this.page.click('button[type="submit"]');
      await this.page.waitForNavigation({ waitUntil: "networkidle2" });
      this.sendLog("2FA code entered and submitted.");
    }

    if (this.page.url().includes("instagram.com")) {
      this.sendLog("Logged in successfully.");
    } else {
      throw new Error("Login failed or unexpected page loaded.");
    }
  }

  async navigateToOwnProfile() {
    this.sendLog("Navigating to own profile...");
    await this.dismissPopups();
    await this.page.goto(`https://www.instagram.com/${this.username}/`, {
      waitUntil: "networkidle2",
    });
    this.sendLog("Profile page loaded.");
  }

  async dismissPopups() {
    const dismissSelectors = [
      "button:contains('Not Now')",
      "button:contains('Cancel')",
      "button._a9--",
    ];

    for (const selector of dismissSelectors) {
      try {
        this.sendLog(`Checking for popup with selector: ${selector}`);
        const elements = await this.page.$$(selector);
        if (elements.length > 0) {
          this.sendLog(`Popup found, clicking the button.`);
          await elements[0].click();
          await this.page.waitForTimeout(1000); // Wait for a second to ensure the popup is dismissed
        } else {
          this.sendLog(`No popup found for selector: ${selector}`);
        }
      } catch (e) {
        this.sendLog(`Error while dismissing popup with selector ${selector}: ${e.message}`);
      }
    }
  }

  async takeProfileScreenshot(username) {
    this.sendLog("Taking profile screenshot...");

    // Scroll to the top to capture the profile header
    await this.page.evaluate(() => window.scrollTo(0, 0));
    const profileHeaderSelector = "header";
    const profileHeader = await this.page.$(profileHeaderSelector);
    if (profileHeader) {
      const profileScreenshotPath = path.join(
        __dirname, "files", "instagram", username, `${username}_profile_header.png`
      );
      await profileHeader.screenshot({ path: profileScreenshotPath });
      this.sendLog(`Profile header screenshot saved as ${profileScreenshotPath}.`);
    } else {
      this.sendLog("Failed to capture profile header.");
    }
  }

  async takePostsScreenshot(username) {
    this.sendLog("Taking posts screenshot...");

    // Remove the header section by setting its display to 'none'
    await this.page.evaluate(() => {
        const header = document.querySelector('header');
        if (header) {
            header.style.display = 'none';
        }
    });

    // Now select the entire body to capture the posts section
    const postsSection = await this.page.$('body');

    if (postsSection) {
        const dirPath = path.join(__dirname, "files", "instagram", username);
        await fs.promises.mkdir(dirPath, { recursive: true });

        let previousHeight;
        let screenshotIndex = 1;

        while (true) {
            previousHeight = await this.page.evaluate(() => document.body.scrollHeight);
            const postScreenshotPath = path.join(
                dirPath,
                `${username}_posts_part_${screenshotIndex}.png`
            );
            await postsSection.screenshot({ path: postScreenshotPath });
            this.sendLog(`Posts screenshot saved as ${postScreenshotPath}.`);

            await this.page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for 2 seconds
            const currentHeight = await this.page.evaluate(() => document.body.scrollHeight);
            if (currentHeight === previousHeight) break;

            screenshotIndex++;
        }
    } else {
        this.sendLog("Failed to capture posts section.");
    }
}


  async close() {
    this.sendLog("Closing browser...");
    await this.browser.close();
    this.sendLog("Browser closed.");
  }
}


ipcMain.handle("start-bot", async (event, { username, password }) => {
  const logs = [];
  const sendLog = (message) => {
    logs.push(message);
    mainWindow.webContents.send("update-logs", message); // Send log message to renderer
  };

  try {
    const bot = new InstagramBot(username, password, sendLog);
    await bot.init();
    sendLog("Bot initialized.");
    await bot.login();
    await bot.navigateToOwnProfile();

    // Capture the profile header
    await bot.takeProfileScreenshot(username);
    
    // Capture the posts section
    await bot.takePostsScreenshot(username);
    
    await bot.close();

    sendLog("Bot process completed.");
    return { success: true };
  } catch (error) {
    sendLog(`Error: ${error.message}`);
    console.error("Error occurred in main process:", error);
    return { success: false, error: error.message };
  }
});


app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
