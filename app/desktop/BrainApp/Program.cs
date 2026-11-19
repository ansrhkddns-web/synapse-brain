// SYNAPSE BRAIN 윈도우 프로그램
//   자기 창(제목 표시줄·작업 표시줄 아이콘이 SYNAPSE BRAIN) 안에 화면을 WebView2로 넣는다 — 브라우저 창이 아니다.
//   창을 닫으면 트레이로 숨고 서버는 계속 돈다(작업 기록·예약이 끊기지 않게). 트레이 메뉴에서 서버 켜기·끄기·자동 시작·종료.
//   한 번 더 실행하면 새로 뜨지 않고 떠 있는 창을 앞으로 가져온다. --tray: 로그인 때 창 없이 트레이로만.
// 빌드: desktop\build.ps1
using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Net.Http;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace SynapseBrain;

static class Program {
  public const string Url = "http://127.0.0.1:4747/";
  public static readonly string AppDir = FindAppDir();
  public static readonly string Ctl = Path.Combine(AppDir, "scripts", "brain-ctl.ps1");
  public static readonly string Data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SYNAPSE BRAIN");

  [STAThread]
  static void Main(string[] args) {
    using var mutex = new Mutex(true, "SYNAPSE-BRAIN-APP", out bool first);
    using var wake = new EventWaitHandle(false, EventResetMode.AutoReset, "SYNAPSE-BRAIN-APP-SHOW");
    if (!first) { wake.Set(); return; }   // 이미 떠 있으면 그 창을 앞으로
    Directory.CreateDirectory(Data);
    Note($"프로그램 시작 (앱 폴더 {AppDir})");
    Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
    Application.ThreadException += (s, e) => Log(e.Exception);
    AppDomain.CurrentDomain.UnhandledException += (s, e) => Log(e.ExceptionObject as Exception);
    ApplicationConfiguration.Initialize();
    var form = new MainForm(startHidden: args.Contains("--tray"));
    // 두 번째 실행의 신호를 기다렸다가 창을 띄운다
    var t = new Thread(() => { while (wake.WaitOne()) form.BeginInvoke(form.ShowWindow); }) { IsBackground = true };
    t.Start();
    Application.Run(form);
  }

  // exe가 app\desktop\에 있으면 그 위, 아니면(빌드 폴더에서 바로 실행) 위로 올라가며 scripts\brain-ctl.ps1이 있는 폴더
  static string FindAppDir() {
    var d = new DirectoryInfo(AppContext.BaseDirectory);
    while (d != null && !File.Exists(Path.Combine(d.FullName, "scripts", "brain-ctl.ps1"))) d = d.Parent;
    return d?.FullName ?? AppContext.BaseDirectory;
  }

  public static void Log(Exception? e) => Note(e?.ToString() ?? "(알 수 없는 오류)");

  // 프로그램 기록: app\logs\app.log (못 쓰면 %LOCALAPPDATA%\SYNAPSE BRAIN\app.log)
  public static void Note(string msg) {
    var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {msg}{Environment.NewLine}";
    foreach (var dir in new[] { Path.Combine(AppDir, "logs"), Data }) {
      try { Directory.CreateDirectory(dir); File.AppendAllText(Path.Combine(dir, "app.log"), line); return; } catch { }
    }
  }

  // 켜고 끄기는 scripts\brain-ctl.ps1에 맡긴다 (창 없이)
  public static string Ctl_(string action) {
    try {
      var psi = new ProcessStartInfo("powershell.exe", $"-NoProfile -ExecutionPolicy Bypass -File \"{Ctl}\" {action}") {
        UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true,
      };
      using var p = Process.Start(psi);
      string o = p.StandardOutput.ReadToEnd();
      p.WaitForExit(60000);
      return o;
    } catch (Exception e) { Log(e); return "error"; }
  }

  public static void OpenExternal(string url) {
    try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch (Exception e) { Log(e); }
  }

  // 아이콘: 먹색 둥근 사각형 위에 빛나는 신경세포 셋 (켜짐 하늘색 · 꺼짐 회색 · 켜는 중 노랑)
  public static Icon MakeIcon(Color sig, bool glow) {
    var bmp = new Bitmap(32, 32);
    using (var g = Graphics.FromImage(bmp)) { g.SmoothingMode = SmoothingMode.AntiAlias; DrawMark(g, 32, sig, glow); }
    return Icon.FromHandle(bmp.GetHicon());
  }

  public static void DrawMark(Graphics g, float n, Color sig, bool glow) {
    float r = n * 0.22f;
    using (var path = new GraphicsPath()) {
      path.AddArc(0, 0, r * 2, r * 2, 180, 90);
      path.AddArc(n - r * 2 - 1, 0, r * 2, r * 2, 270, 90);
      path.AddArc(n - r * 2 - 1, n - r * 2 - 1, r * 2, r * 2, 0, 90);
      path.AddArc(0, n - r * 2 - 1, r * 2, r * 2, 90, 90);
      path.CloseFigure();
      using var bg = new SolidBrush(Color.FromArgb(30, 29, 27));
      g.FillPath(bg, path);
    }
    PointF a = new(n * 0.27f, n * 0.68f), b = new(n * 0.52f, n * 0.30f), c = new(n * 0.76f, n * 0.62f);
    using (var line = new Pen(Color.FromArgb(glow ? 200 : 140, sig), Math.Max(1.5f, n * 0.06f))) {
      g.DrawLine(line, a, b); g.DrawLine(line, b, c); g.DrawLine(line, a, c);
    }
    foreach (var p in new[] { a, b, c }) {
      float big = p == b ? n * 0.13f : n * 0.095f;
      if (glow) { using var halo = new SolidBrush(Color.FromArgb(70, sig)); g.FillEllipse(halo, p.X - big * 1.8f, p.Y - big * 1.8f, big * 3.6f, big * 3.6f); }
      using var dot = new SolidBrush(p == b ? Color.White : sig);
      g.FillEllipse(dot, p.X - big, p.Y - big, big * 2, big * 2);
    }
  }
}

sealed class MainForm : Form {
  static readonly Color Ink = Color.FromArgb(24, 23, 21);   // 먹색 바탕 (화면이 뜨기 전)
  readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Ink };
  // 화면을 덮는 안내판: 켜는 중 · 꺼짐 · 응답 없음 — 꺼짐/응답 없음이면 창 안에서 바로 켜거나 다시 시작한다
  readonly Panel cover = new() { Dock = DockStyle.Fill, BackColor = Ink };
  readonly Label wait = new() { AutoSize = false, TextAlign = ContentAlignment.MiddleCenter, ForeColor = Color.FromArgb(160, 156, 148), BackColor = Ink, Font = new Font("Segoe UI", 12f), Text = "SYNAPSE BRAIN 켜는 중…" };
  readonly Button btnMain = MakeButton("서버 다시 시작", true), btnLogs = MakeButton("로그 폴더 열기", false);
  readonly NotifyIcon tray;
  readonly ToolStripMenuItem itemToggle, itemRestart, itemAuto;
  readonly Icon iconOn = Program.MakeIcon(Color.FromArgb(95, 230, 255), true), iconOff = Program.MakeIcon(Color.FromArgb(120, 120, 120), false), iconBusy = Program.MakeIcon(Color.FromArgb(229, 192, 123), true);
  readonly System.Windows.Forms.Timer poll = new() { Interval = 3000 };
  static readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(4) };
  readonly string boundsFile = Path.Combine(Program.Data, "window.json");
  bool up, busy, quitting, loaded, hintShown, startHidden;
  // hung = 서버 프로세스는 떠 있는데(4747 열림) 대답을 안 함. 90초 넘게 이어지면 알아서 한 번 다시 시작한다
  bool hung;
  int failStreak;
  int lastNeeds = -1;
  DateTime busySince, hungSince, lastAutoRestart = DateTime.MinValue;
  static readonly TimeSpan AutoRestartAfter = TimeSpan.FromSeconds(90);

  static Button MakeButton(string text, bool primary) {
    var b = new Button {
      Text = text, AutoSize = false, Size = new Size(170, 38), FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand,
      Font = new Font("Segoe UI", 10f, primary ? FontStyle.Bold : FontStyle.Regular),
      ForeColor = primary ? Color.FromArgb(24, 23, 21) : Color.FromArgb(200, 196, 188),
      BackColor = primary ? Color.FromArgb(95, 230, 255) : Color.FromArgb(38, 37, 34),
    };
    b.FlatAppearance.BorderColor = primary ? Color.FromArgb(95, 230, 255) : Color.FromArgb(70, 68, 64);
    return b;
  }

  // 안내판 내용: 글 + (필요하면) 버튼
  void ShowCover(string text, string? action = null) {
    wait.Text = text;
    btnMain.Visible = action != null;
    btnLogs.Visible = action != null;
    if (action != null) btnMain.Text = action;
    cover.Visible = true;
    cover.BringToFront();
    LayoutCover();
  }

  void LayoutCover() {
    int w = cover.ClientSize.Width, h = cover.ClientSize.Height;
    wait.SetBounds(20, h / 2 - 70, Math.Max(100, w - 40), 60);
    int gap = 12, total = btnMain.Width + gap + btnLogs.Width;
    btnMain.Location = new Point((w - total) / 2, h / 2);
    btnLogs.Location = new Point(btnMain.Right + gap, h / 2);
  }

  public MainForm(bool startHidden) {
    this.startHidden = startHidden;
    Text = "SYNAPSE BRAIN";
    using (var s = typeof(Program).Assembly.GetManifestResourceStream("brain.ico")) Icon = new Icon(s);
    BackColor = Ink;
    MinimumSize = new Size(900, 600);
    StartPosition = FormStartPosition.Manual;
    RestoreBounds_();
    Controls.Add(web);
    cover.Controls.AddRange(new Control[] { wait, btnMain, btnLogs });
    cover.Resize += (s, e) => LayoutCover();
    btnMain.Click += (s, e) => { if (up && !hung) return; if (hung || up) RestartServer(); else StartServer(); };
    btnLogs.Click += (s, e) => Program.OpenExternal(Path.Combine(Program.AppDir, "logs"));
    Controls.Add(cover);
    ShowCover("SYNAPSE BRAIN 켜는 중…");

    var menu = new ContextMenuStrip();
    var open = new ToolStripMenuItem("창 열기", null, (s, e) => ShowWindow()) { Font = new Font(SystemFonts.MenuFont, FontStyle.Bold) };
    itemToggle = new ToolStripMenuItem("서버 끄기", null, (s, e) => { if (up || hung) StopServer(); else StartServer(); });
    itemRestart = new ToolStripMenuItem("서버 다시 시작", null, (s, e) => RestartServer());
    itemAuto = new ToolStripMenuItem("윈도우 켤 때 자동으로 켜기", null, (s, e) => ToggleAuto());
    menu.Items.AddRange(new ToolStripItem[] {
      open, new ToolStripSeparator(), itemToggle, itemRestart, itemAuto,
      new ToolStripMenuItem("로그 폴더 열기", null, (s, e) => Program.OpenExternal(Path.Combine(Program.AppDir, "logs"))),
      new ToolStripSeparator(),
      new ToolStripMenuItem("종료 (서버는 계속)", null, (s, e) => Quit(false)),
      new ToolStripMenuItem("서버 끄고 종료", null, (s, e) => Quit(true)),
    });
    menu.Opening += (s, e) => RefreshMenu();
    tray = new NotifyIcon { Icon = iconOff, Text = "SYNAPSE BRAIN", ContextMenuStrip = menu, Visible = true };
    tray.DoubleClick += (s, e) => ShowWindow();
    tray.BalloonTipClicked += (s, e) => ShowWindow();

    poll.Tick += async (s, e) => await Poll();
  }

  protected override void SetVisibleCore(bool value) {
    // --tray로 켜면 첫 표시를 건너뛴다 (핸들은 만들어 둔다)
    if (startHidden && !IsHandleCreated) { CreateHandle(); value = false; }
    base.SetVisibleCore(value);
  }

  [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
  static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

  protected override async void OnHandleCreated(EventArgs e) {
    base.OnHandleCreated(e);
    // 제목 표시줄도 먹색으로 (윈도우 11: 어두운 모드 20 · 제목 표시줄 색 35 · 제목 글자 색 36)
    int dark = 1, caption = Ink.R | Ink.G << 8 | Ink.B << 16, textColor = 0xB4BCC0;
    DwmSetWindowAttribute(Handle, 20, ref dark, 4);
    DwmSetWindowAttribute(Handle, 35, ref caption, 4);
    DwmSetWindowAttribute(Handle, 36, ref textColor, 4);
    itemAuto.Checked = Program.Ctl_("status").Contains("auto-on");
    await InitWeb();
    await Poll();
    if (!up) StartServer();
    poll.Start();
  }

  async Task InitWeb() {
    try {
      var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.Data, "WebView2"));
      await web.EnsureCoreWebView2Async(env);
      var w = web.CoreWebView2;
      w.Settings.IsStatusBarEnabled = false;
      w.Settings.AreDevToolsEnabled = false;
      w.Settings.IsZoomControlEnabled = true;
      w.Settings.IsGeneralAutofillEnabled = false;
      w.Settings.IsPasswordAutosaveEnabled = false;
      // 새 창(링크 target=_blank·window.open)과 바깥 주소는 기본 브라우저로
      w.NewWindowRequested += (s, e) => { e.Handled = true; Program.OpenExternal(e.Uri); };
      w.NavigationStarting += (s, e) => {
        if (!e.Uri.StartsWith(Program.Url) && !e.Uri.StartsWith("about:")) { e.Cancel = true; Program.OpenExternal(e.Uri); }
      };
      w.DocumentTitleChanged += (s, e) => Text = string.IsNullOrWhiteSpace(w.DocumentTitle) || w.DocumentTitle == "SYNAPSE BRAIN" ? "SYNAPSE BRAIN" : $"SYNAPSE BRAIN — {w.DocumentTitle}";
      w.NavigationCompleted += (s, e) => {
        if (e.IsSuccess) { loaded = true; cover.Visible = false; }
        else if (!quitting) { loaded = false; if (up) ShowCover("화면을 여는 중…"); else ShowCover("서버가 꺼져 있어요", "서버 켜기"); }
      };
    } catch (Exception ex) {
      Program.Log(ex);
      ShowCover("화면 구성요소(WebView2)를 열지 못했어요 — logs\\app.log");
    }
  }

  // 4747이 열려 있는지 (열려 있는데 대답이 없으면 멈춘 것)
  static async Task<bool> PortOpen() {
    try {
      using var c = new System.Net.Sockets.TcpClient();
      var t = c.ConnectAsync("127.0.0.1", 4747);
      return await Task.WhenAny(t, Task.Delay(1500)) == t && c.Connected;
    } catch { return false; }
  }

  bool polling;

  async Task Poll() {
    if (polling || quitting) return;
    polling = true;
    try { await PollOnce(); } catch (Exception e) { Program.Log(e); } finally { polling = false; }
  }

  async Task PollOnce() {
    int needs = -1;
    bool ok = false;
    try {
      using var doc = JsonDocument.Parse(await http.GetStringAsync(Program.Url + "api/state"));
      ok = true;
      if (doc.RootElement.TryGetProperty("needsMe", out var n) && n.TryGetInt32(out var v)) needs = v;
    } catch { }
    // 대답이 없을 때: 4747이 열려 있으면 "응답 없음"(멈춤), 닫혀 있으면 "꺼짐"
    bool listening = ok || await PortOpen();
    failStreak = ok ? 0 : failStreak + 1;
    bool wasHung = hung;
    hung = !ok && listening && failStreak >= 2;   // 한 번 늦은 건 넘어간다 (약 8초 넘게 대답이 없을 때부터)
    if (hung && !wasHung) hungSince = DateTime.Now;
    if (!hung && wasHung && ok) Program.Note($"서버 응답 돌아옴 ({(DateTime.Now - hungSince).TotalSeconds:0}초 멈춤)");

    bool cameUp = ok && !up;
    up = ok || (listening && !hung);   // 잠깐 늦는 동안은 켜짐으로 둔다
    if (ok) busy = false;
    if (busy && DateTime.Now - busySince > TimeSpan.FromSeconds(45)) {
      busy = false;
      tray.ShowBalloonTip(5000, "SYNAPSE BRAIN", "서버가 켜지지 않았어요. 창의 버튼으로 다시 시작하거나 로그 폴더를 확인해 주세요.", ToolTipIcon.Warning);
    }

    // 멈춘 채 90초가 넘으면 알아서 한 번 다시 시작 (5분 안에 또 멈추면 사람에게 맡긴다)
    var stuck = DateTime.Now - hungSince;
    if (hung && !busy && stuck > AutoRestartAfter && DateTime.Now - lastAutoRestart > TimeSpan.FromMinutes(5)) {
      lastAutoRestart = DateTime.Now;
      Program.Note($"서버가 {stuck.TotalSeconds:0}초째 응답 없음 — 자동으로 다시 시작");
      tray.ShowBalloonTip(5000, "SYNAPSE BRAIN", $"서버가 {stuck.TotalSeconds:0}초째 응답이 없어 다시 시작했어요.", ToolTipIcon.Warning);
      RestartServer();
      return;
    }

    tray.Icon = busy ? iconBusy : hung ? iconBusy : up ? iconOn : iconOff;
    var text = busy ? "SYNAPSE BRAIN — 켜는 중…" : hung ? "SYNAPSE BRAIN — 응답 없음" : up ? "SYNAPSE BRAIN — 켜짐" + (needs > 0 ? $" · 내 차례 {needs}" : "") : "SYNAPSE BRAIN — 꺼짐";
    tray.Text = text.Length > 63 ? text[..63] : text;
    if (ok && needs > lastNeeds && lastNeeds >= 0 && !Visible) tray.ShowBalloonTip(4000, "SYNAPSE BRAIN", $"내 차례가 {needs}건 있어요. 눌러서 열기", ToolTipIcon.Info);
    if (ok) lastNeeds = needs;

    if (!quitting && !busy) {
      if (hung) {
        int sec = (int)stuck.TotalSeconds;
        bool autoLeft = DateTime.Now - lastAutoRestart > TimeSpan.FromMinutes(5);
        ShowCover($"서버가 {sec}초째 응답하지 않아요" + (autoLeft ? $" — {Math.Max(0, (int)AutoRestartAfter.TotalSeconds - sec)}초 뒤 자동으로 다시 시작해요" : " — 다시 시작해 주세요"), "서버 다시 시작");
        loaded = false;
      } else if (!up) {
        ShowCover("서버가 꺼져 있어요", "서버 켜기");
        loaded = false;
      }
    }
    if (web.CoreWebView2 != null && ok && (cameUp || !loaded)) { ShowCover("화면을 여는 중…"); web.CoreWebView2.Navigate(Program.Url); }
    RefreshMenu();
  }

  void RefreshMenu() {
    itemToggle.Text = busy ? "켜는 중…" : up || hung ? "서버 끄기" : "서버 켜기";
    itemToggle.Enabled = !busy;
    itemRestart.Text = hung ? "서버 다시 시작 (응답 없음)" : "서버 다시 시작";
    itemRestart.Enabled = !busy;
  }

  void StartServer() {
    busy = true; busySince = DateTime.Now;
    ShowCover("SYNAPSE BRAIN 켜는 중…");
    tray.Icon = iconBusy;
    RefreshMenu();
    Task.Run(() => Program.Ctl_("start"));
  }

  // 멈춰 있어도 강제로 끄고 다시 켠다 (brain-ctl restart)
  void RestartServer() {
    Program.Note("서버 다시 시작");
    busy = true; busySince = DateTime.Now;
    hung = false; failStreak = 0; up = false; loaded = false;
    ShowCover("서버를 다시 시작하는 중…");
    tray.Icon = iconBusy;
    RefreshMenu();
    Task.Run(() => Program.Ctl_("restart"));
  }

  void StopServer() {
    Task.Run(() => Program.Ctl_("stop")).ContinueWith(_ => BeginInvoke(() => { up = false; hung = false; lastNeeds = -1; loaded = false; _ = Poll(); }));
  }

  void ToggleAuto() {
    Program.Ctl_(itemAuto.Checked ? "auto-off" : "auto-on");
    itemAuto.Checked = Program.Ctl_("status").Contains("auto-on");
  }

  public void ShowWindow() {
    startHidden = false;
    Show();
    if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
    Activate();
    BringToFront();
  }

  // 닫기(X) = 트레이로 숨기. 서버와 작업 기록은 계속
  protected override void OnFormClosing(FormClosingEventArgs e) {
    SaveBounds();
    if (!quitting && e.CloseReason == CloseReason.UserClosing) {
      e.Cancel = true;
      Hide();
      if (!hintShown) { hintShown = true; tray.ShowBalloonTip(3000, "SYNAPSE BRAIN", "트레이에서 계속 돌아요. 끄려면 아이콘을 오른쪽 클릭 → 종료", ToolTipIcon.Info); }
      return;
    }
    base.OnFormClosing(e);
  }

  void Quit(bool stopServer) {
    quitting = true;
    SaveBounds();
    if (stopServer) Program.Ctl_("stop");
    tray.Visible = false;
    Application.Exit();
  }

  record WinBounds(int X, int Y, int W, int H, bool Max);

  void RestoreBounds_() {
    try {
      var b = JsonSerializer.Deserialize<WinBounds>(File.ReadAllText(boundsFile));
      var r = new Rectangle(b.X, b.Y, b.W, b.H);
      if (Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(r))) { Bounds = r; if (b.Max) WindowState = FormWindowState.Maximized; return; }
    } catch { }
    var wa = Screen.PrimaryScreen.WorkingArea;
    var size = new Size(Math.Min(1600, wa.Width - 80), Math.Min(1000, wa.Height - 80));
    Bounds = new Rectangle(wa.X + (wa.Width - size.Width) / 2, wa.Y + (wa.Height - size.Height) / 2, size.Width, size.Height);
  }

  void SaveBounds() {
    try {
      var r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
      File.WriteAllText(boundsFile, JsonSerializer.Serialize(new WinBounds(r.X, r.Y, r.Width, r.Height, WindowState == FormWindowState.Maximized)));
    } catch { }
  }
}
