using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Printing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Bravos.NativePrint
{
  public static class Host
  {
    const int Dpi = 203;
    const int QuietModules = 10;
    const string LabelPrinter = "Xprinter XP-236B";
    const string ReceiptPrinter = "Bravos Receipts - Xprinter XP-80TS";
    const string LabelDriver = "Xprinter XP-236B";
    const string ReceiptDriver = "Xprinter XP-80";

    static readonly Regex Money = new Regex("^(?:0|[1-9]\\d{0,7})(?:\\.\\d{2})?$", RegexOptions.CultureInvariant);
    static readonly Regex Quantity = new Regex("^(?:[1-9]\\d{0,5}|1000000) \u00d7 (?:0|[1-9]\\d{0,7})(?:\\.\\d{2})?$", RegexOptions.CultureInvariant);
    static readonly Regex CairoTime = new Regex("^(\\d{2}/\\d{2}/\\d{4}) (\\d{2}):(\\d{2})$", RegexOptions.CultureInvariant);
    static readonly Color PaperGray = Color.FromArgb(230, 230, 228);
    static readonly Color InkBlack = Color.FromArgb(21, 21, 21);

    public static string Classify(string json)
    {
      try
      {
        Job job;
        string error = Parse(json, out job);
        if (error != null) return Fail(error);
        if (job.Action == "probe") return "{\"ok\":true,\"action\":\"probe\",\"kind\":\"\",\"printInvoked\":false}";
        return "{\"ok\":true,\"action\":\"" + job.Action + "\",\"kind\":\"" + job.Kind + "\",\"printInvoked\":false}";
      }
      catch
      {
        return Fail("invalid_job");
      }
    }

    public static string Preview(string json, string fontPath, string logoPath)
    {
      try
      {
        Job job;
        string error = Parse(json, out job);
        if (error != null) return Fail(error);
        if (job.Action != "preview") return Fail("invalid_job");
        return Render(job, fontPath, logoPath, false, null);
      }
      catch
      {
        return Fail("renderer_unavailable");
      }
    }

    public static string PrintJob(string json, string fontPath, string logoPath)
    {
      PrintAttempt attempt = new PrintAttempt();
      try
      {
        Job job;
        string error = Parse(json, out job);
        if (error != null) return Fail(error);
        if (job.Action != "print") return Fail("invalid_job");
        return Render(job, fontPath, logoPath, true, attempt);
      }
      catch
      {
        if (attempt.PrintMayHaveRun) return "{\"ok\":false,\"outcome\":\"unknown\",\"printInvoked\":true}";
        return Fail("renderer_unavailable");
      }
    }

    public static string ProbeQueue(string role, bool found, string driver, bool workOffline, string port, string status, bool truncated, string[] ids, string[] statuses)
    {
      try
      {
        if (role != "label" && role != "receipt") return "{\"found\":false,\"driverName\":\"\",\"workOffline\":false,\"portName\":\"\",\"status\":\"\",\"truncated\":true,\"devices\":[]}";
        string safeDriver = SafeToken(driver, 80, true);
        string safePort = SafeToken(port, 16, false);
        string safeStatus = SafeToken(status, 40, true);
        StringBuilder builder = new StringBuilder();
        builder.Append("{\"found\":").Append(found ? "true" : "false");
        builder.Append(",\"driverName\":").Append(Quote(safeDriver));
        builder.Append(",\"workOffline\":").Append(workOffline ? "true" : "false");
        builder.Append(",\"portName\":").Append(Quote(safePort));
        builder.Append(",\"status\":").Append(Quote(safeStatus));
        builder.Append(",\"truncated\":").Append(truncated ? "true" : "false");
        builder.Append(",\"devices\":[");
        bool first = true;
        if (ids != null && statuses != null && ids.Length == statuses.Length)
        {
          int count = ids.Length > 16 ? 16 : ids.Length;
          for (int i = 0; i < count; i++)
          {
            string id = SafeDevice(ids[i]);
            string deviceStatus = SafeToken(statuses[i], 40, false);
            if (id == null || deviceStatus.Length == 0) continue;
            if (!first) builder.Append(',');
            first = false;
            builder.Append("{\"id\":").Append(Quote(id)).Append(",\"status\":").Append(Quote(deviceStatus)).Append('}');
          }
        }
        builder.Append("]}");
        return builder.ToString();
      }
      catch
      {
        return "{\"found\":false,\"driverName\":\"\",\"workOffline\":false,\"portName\":\"\",\"status\":\"\",\"truncated\":true,\"devices\":[]}";
      }
    }

    public static string ProbeEnvelope(string labelJson, string receiptJson)
    {
      try
      {
        if (labelJson == null || receiptJson == null || labelJson.Length < 2 || receiptJson.Length < 2) return Fail("renderer_unavailable");
        if (labelJson[0] != '{' || receiptJson[0] != '{') return Fail("renderer_unavailable");
        if (labelJson.IndexOf("printInvoked", StringComparison.Ordinal) >= 0) return Fail("renderer_unavailable");
        return "{\"ok\":true,\"outcome\":\"probe\",\"printInvoked\":false,\"queues\":{\"label\":" + labelJson + ",\"receipt\":" + receiptJson + "}}";
      }
      catch
      {
        return Fail("renderer_unavailable");
      }
    }

    public static string Gate(string role, bool found, string driver, bool workOffline, string port, string status, bool truncated, string[] ids, string[] statuses)
    {
      try
      {
        if (truncated) return "unsupported_driver";
        if (role != "label" && role != "receipt") return "unsupported_driver";
        if (!found) return "printer_missing";
        string expected = role == "label" ? LabelDriver : ReceiptDriver;
        if (driver != expected) return "unsupported_driver";
        if (!IsUsbPort(port)) return "unsupported_driver";
        if (workOffline || !StatusAllows(status)) return "printer_offline";
        if (ids == null || statuses == null || ids.Length != statuses.Length || ids.Length > 16) return "printer_offline";
        for (int i = 0; i < ids.Length; i++)
        {
          if (DeviceMatches(role, port, ids[i], statuses[i])) return "ready";
        }
        return "printer_offline";
      }
      catch
      {
        return "unsupported_driver";
      }
    }

    static string Render(Job job, string fontPath, string logoPath, bool submit, PrintAttempt attempt)
    {
      if (!TrustedAsset(fontPath, "Cairo-Regular.ttf") || !TrustedAsset(logoPath, "bravos-receipt-logo.png")) return Fail("renderer_unavailable");
      Fonts fonts = Fonts.Load(fontPath, logoPath);
      Drawn drawn = null;
      try
      {
        if (fonts.Error != null) return Fail(fonts.Error);
        drawn = job.Kind == "label" ? DrawLabel(job, fonts) : DrawReceipt(job, fonts);
        if (drawn.Error != null) return Fail(drawn.Error);
        if (drawn.Pages.Count < 1 || drawn.Pages.Count > 6) return Fail("invalid_layout");
        if (!submit) return PreviewJson(job, drawn);
        return Submit(job, drawn.Pages, attempt);
      }
      finally
      {
        if (drawn != null)
        {
          for (int i = 0; i < drawn.Pages.Count; i++) drawn.Pages[i].Dispose();
        }
        fonts.Dispose();
      }
    }

    static Drawn DrawLabel(Job job, Fonts fonts)
    {
      Drawn drawn = new Drawn();
      int width = Mm(38);
      int height = Mm(25);
      int inset = Mm(2);
      int contentW = width - inset * 2;
      int contentH = height - inset * 2;
      int total = job.Modules.Length + QuietModules * 2;
      int dots = total * 2 <= contentW ? 2 : 1;
      int barcodeW = total * dots;
      if (barcodeW > contentW) { drawn.Error = "invalid_layout"; return drawn; }
      int origin = (width - barcodeW) / 2;
      if (origin < inset || origin + barcodeW > width - inset) { drawn.Error = "invalid_layout"; return drawn; }

      Bitmap scratch = new Bitmap(width, 8, PixelFormat.Format24bppRgb);
      scratch.SetResolution(Dpi, Dpi);
      Graphics measure = Graphics.FromImage(scratch);
      measure.PageUnit = GraphicsUnit.Pixel;
      try
      {
        if (!Calibrate(measure, fonts.LabelCode) || !Calibrate(measure, fonts.LabelName) || !Calibrate(measure, fonts.LabelBrand)) { drawn.Error = "invalid_layout"; return drawn; }
        List<string> brandLines = Wrap(measure, "Bravos", fonts.LabelBrand, contentW, false);
        string priceText = job.Price == null ? null : job.Price + " EGP";
        int codeWidth = priceText == null ? contentW : contentW * 58 / 100;
        List<string> codeLines = Wrap(measure, job.Code, fonts.LabelCode, codeWidth, false);
        List<string> nameLines = Wrap(measure, job.Name, fonts.LabelName, contentW, HasArabic(job.Name));
        List<string> priceLines = priceText == null ? null : Wrap(measure, priceText, fonts.LabelPrice, contentW - codeWidth - Mm(1), false);
        if (brandLines == null || codeLines == null || nameLines == null || (priceText != null && priceLines == null)) { drawn.Error = "invalid_layout"; return drawn; }
        int brandH = BlockHeight(measure, brandLines, fonts.LabelBrand, false);
        int codeH = BlockHeight(measure, codeLines, fonts.LabelCode, false);
        int priceH = priceLines == null ? 0 : BlockHeight(measure, priceLines, fonts.LabelPrice, false);
        int nameH = BlockHeight(measure, nameLines, fonts.LabelName, HasArabic(job.Name));
        if (brandH < 1 || codeH < 1 || nameH < 1) { drawn.Error = "invalid_layout"; return drawn; }
        int rowH = Math.Max(codeH, priceH);
        int brandGap = Mm(0.25);
        int textGap = Mm(0.5);
        int nameGap = Mm(0.25);
        int bar = contentH - brandH - brandGap - textGap - rowH - nameGap - nameH;
        if (bar < Mm(10)) { drawn.Error = "invalid_layout"; return drawn; }
        Bitmap page = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        page.SetResolution(Dpi, Dpi);
        Graphics canvas = Graphics.FromImage(page);
        canvas.PageUnit = GraphicsUnit.Pixel;
        canvas.SmoothingMode = SmoothingMode.None;
        canvas.InterpolationMode = InterpolationMode.NearestNeighbor;
        canvas.PixelOffsetMode = PixelOffsetMode.None;
        canvas.Clear(Color.White);
        int textY = inset;
        if (!DrawCentered(canvas, brandLines, fonts.LabelBrand, inset, contentW, ref textY, false, drawn, 0, "brand")) { drawn.Error = "invalid_layout"; canvas.Dispose(); page.Dispose(); return drawn; }
        textY += brandGap;
        using (SolidBrush brush = new SolidBrush(Color.Black))
        {
          int cursor = origin + QuietModules * dots;
          for (int i = 0; i < job.Modules.Length; i++)
          {
            if (job.Modules[i] == '1') canvas.FillRectangle(brush, cursor, textY, dots, bar);
            cursor += dots;
          }
        }
        textY += bar + textGap;
        int rowY = textY;
        if (priceLines == null)
        {
          if (!DrawCentered(canvas, codeLines, fonts.LabelCode, inset, contentW, ref textY, false, drawn, 0, "code")) { drawn.Error = "invalid_layout"; canvas.Dispose(); page.Dispose(); return drawn; }
        }
        else
        {
          int codeY = rowY;
          int priceY = rowY;
          if (!DrawStart(canvas, codeLines, fonts.LabelCode, inset, codeWidth, ref codeY, false, drawn, 0, "code")) { drawn.Error = "invalid_layout"; canvas.Dispose(); page.Dispose(); return drawn; }
          if (!DrawEnd(canvas, priceLines, fonts.LabelPrice, inset, contentW, ref priceY, drawn, 0, "price")) { drawn.Error = "invalid_layout"; canvas.Dispose(); page.Dispose(); return drawn; }
          textY = Math.Max(codeY, priceY);
        }
        textY += nameGap;
        if (!DrawCentered(canvas, nameLines, fonts.LabelName, inset, contentW, ref textY, HasArabic(job.Name), drawn, 0, "name")) { drawn.Error = "invalid_layout"; canvas.Dispose(); page.Dispose(); return drawn; }
        if (textY > height - inset) { drawn.Error = "invalid_layout"; canvas.Dispose(); page.Dispose(); return drawn; }
        canvas.Dispose();
        if (!RememberInk(page, drawn)) { drawn.Error = "invalid_layout"; page.Dispose(); return drawn; }
        drawn.Pages.Add(page);
        drawn.ModuleDots = dots;
        drawn.BarcodeModules = job.Modules.Length;
        drawn.BarcodeWidth = barcodeW;
        drawn.BarHeight = bar;
        drawn.PageWidth = width;
        drawn.PageHeight = height;
      }
      finally
      {
        measure.Dispose();
        scratch.Dispose();
      }
      return drawn;
    }

    static string ReceiptAmount(decimal amount)
    {
      return amount.ToString(amount == Decimal.Truncate(amount) ? "0" : "0.00", CultureInfo.InvariantCulture);
    }

    static void SplitOccurred(string label, out string date, out string time)
    {
      date = label;
      time = null;
      if (label == null) return;
      Match match = CairoTime.Match(label);
      if (!match.Success) return;
      int hour24;
      if (!int.TryParse(match.Groups[2].Value, NumberStyles.None, CultureInfo.InvariantCulture, out hour24)) return;
      if (hour24 < 0 || hour24 > 23) return;
      string minute = match.Groups[3].Value;
      string period = hour24 < 12 ? "ص" : "م";
      int hour12 = hour24 % 12 == 0 ? 12 : hour24 % 12;
      date = match.Groups[1].Value;
      time = hour12.ToString(CultureInfo.InvariantCulture) + ":" + minute + " " + period;
    }

    static void SplitQty(string qty, out string quantity, out string unit)
    {
      quantity = qty;
      unit = "";
      int sep = qty.IndexOf(" \u00d7 ", StringComparison.Ordinal);
      if (sep <= 0) return;
      quantity = qty.Substring(0, sep);
      unit = qty.Substring(sep + 3);
    }

    static Drawn DrawReceipt(Job job, Fonts fonts)
    {
      Drawn drawn = new Drawn();
      int pageW = Mm(80);
      int layoutW = Mm(58);
      int layoutLeft = (pageW - layoutW) / 2;
      int pad = Mm(2.6);
      int textLeft = layoutLeft + pad;
      int textW = layoutW - pad * 2;
      int top = Mm(4);
      int bottom = Mm(4);
      int maxPage = Mm(300);
      Bitmap scratch = new Bitmap(pageW, 8, PixelFormat.Format24bppRgb);
      scratch.SetResolution(Dpi, Dpi);
      Graphics measure = Graphics.FromImage(scratch);
      measure.PageUnit = GraphicsUnit.Pixel;
      try
      {
        if (!Calibrate(measure, fonts.Body) || !Calibrate(measure, fonts.Meta)) { drawn.Error = "invalid_layout"; return drawn; }
        int logoBoxW = Mm(26);
        int logoBoxH = Mm(18);
        double scale = Math.Min(logoBoxW / (double)fonts.Logo.Width, logoBoxH / (double)fonts.Logo.Height);
        int logoW = Math.Max(8, (int)Math.Floor(fonts.Logo.Width * scale + 0.5));
        int logoH = Math.Max(8, (int)Math.Floor(fonts.Logo.Height * scale + 0.5));
        if (logoW > 400 || logoH > 400) { drawn.Error = "invalid_layout"; return drawn; }
        Sheet sheet = new Sheet();
        sheet.PageW = pageW;
        sheet.TextLeft = textLeft;
        sheet.TextW = textW;
        sheet.Top = top;
        sheet.Bottom = bottom;
        sheet.Max = maxPage;
        sheet.Y = top;
        sheet.AddLogo(logoW, logoH, textLeft + (textW - logoW) / 2);
        if (!sheet.AddCentered(measure, "caption", "MEN'S WEAR", fonts.Caption, false, drawn)) return drawn;
        sheet.AddSectionGap();
        string dateLabel;
        string timeLabel;
        SplitOccurred(job.OccurredAt, out dateLabel, out timeLabel);
        if (!sheet.AddMeta(measure, fonts.Meta, drawn,
          job.PrintedReference, dateLabel, timeLabel,
          job.Cashier, job.CustomerName, job.CustomerPhone)) return drawn;
        sheet.AddSectionGap();
        if (!sheet.AddItemRow(measure, new[] { "م", "الصنف", "الكمية", "السعر", "الإجمالي" }, true, fonts.Title, drawn)) return drawn;
        for (int i = 0; i < job.Lines.Count; i++)
        {
          ItemLine line = job.Lines[i];
          string quantity;
          string unit;
          SplitQty(line.Qty, out quantity, out unit);
          if (!sheet.AddItemRow(measure, new[] { (i + 1).ToString(CultureInfo.InvariantCulture), line.Name, quantity, unit, line.Original }, false, fonts.Body, drawn)) return drawn;
        }
        string subtotal = null;
        decimal discount = 0;
        foreach (MoneyLine adjustment in job.Adjustments)
        {
          if (adjustment.Label == "الإجمالي قبل الخصم") subtotal = adjustment.Amount;
          else discount += Decimal.Parse(adjustment.Amount, CultureInfo.InvariantCulture);
        }
        string itemsTotal = discount > 0 ? (subtotal ?? job.FinalTotal) : job.FinalTotal;
        if (!sheet.AddBar(measure, "subtotal", "إجمالي الأصناف", itemsTotal, fonts.Title, drawn)) return drawn;
        if (!sheet.AddPair(measure, "payment", "طريقة الدفع:", job.PaymentMethod, fonts.Body, HasArabic(job.PaymentMethod), drawn)) return drawn;
        if (job.ExchangeCredit != null && !sheet.AddPair(measure, "exchange", "رصيد استبدال", job.ExchangeCredit, fonts.Body, false, drawn)) return drawn;
        bool simpleCash = job.Allocations.Count == 1 && job.Allocations[0].Label == "المبلغ النقدي" && job.PaymentMethod == "نقدي";
        if (!simpleCash)
        {
          for (int i = 0; i < job.Allocations.Count; i++)
          {
            if (!sheet.AddPair(measure, "allocation", job.Allocations[i].Label, job.Allocations[i].Amount, fonts.Body, false, drawn)) return drawn;
          }
        }
        bool collectedAlreadyShown = simpleCash && job.Allocations[0].Amount == job.CashCollected;
        if (job.CashCollected != null && !collectedAlreadyShown && !sheet.AddPair(measure, "collected", "النقد المحصّل", job.CashCollected, fonts.Body, false, drawn)) return drawn;
        if (discount > 0)
        {
          sheet.AddRule();
          if (!sheet.AddPair(measure, "discount", "الخصم:", ReceiptAmount(discount), fonts.Body, false, drawn)) return drawn;
          if (!sheet.AddPill(measure, "total", "الإجمالي بعد الخصم", job.FinalTotal, fonts.Total, drawn)) return drawn;
        }
        if (!sheet.AddFooter(measure, "footer", "استايلك على كيفك", fonts.Title, drawn)) return drawn;
        sheet.Finish();
        if (sheet.Error != null) { drawn.Error = sheet.Error; return drawn; }
        if (sheet.PageCount < 1 || sheet.PageCount > 6) { drawn.Error = "invalid_layout"; return drawn; }
        for (int pageIndex = 0; pageIndex < sheet.PageCount; pageIndex++)
        {
          int pageH = sheet.Heights[pageIndex];
          if (pageH < top + bottom || pageH > maxPage) { drawn.Error = "invalid_layout"; return drawn; }
          Bitmap page = new Bitmap(pageW, pageH, PixelFormat.Format24bppRgb);
          page.SetResolution(Dpi, Dpi);
          Graphics canvas = Graphics.FromImage(page);
          canvas.PageUnit = GraphicsUnit.Pixel;
          canvas.SmoothingMode = SmoothingMode.AntiAlias;
          canvas.PixelOffsetMode = PixelOffsetMode.None;
          canvas.Clear(Color.White);
          for (int m = 0; m < sheet.Marks.Count; m++)
          {
            Mark mark = sheet.Marks[m];
            if (mark.Page != pageIndex) continue;
            if (mark.Kind == "logo")
            {
              canvas.InterpolationMode = InterpolationMode.HighQualityBicubic;
              canvas.DrawImage(fonts.Logo, new Rectangle(mark.X, mark.Y, mark.W, mark.H));
              canvas.InterpolationMode = InterpolationMode.NearestNeighbor;
            }
            else if (mark.Kind == "rule")
            {
              using (Pen pen = new Pen(Color.FromArgb(85, 85, 85), 1)) canvas.DrawLine(pen, mark.X, mark.Y, mark.X + mark.W, mark.Y);
            }
            else if (mark.Kind == "vline")
            {
              using (Pen pen = new Pen(Color.FromArgb(85, 85, 85), 1)) canvas.DrawLine(pen, mark.X, mark.Y, mark.X, mark.Y + mark.H);
            }
            else if (mark.Kind == "fill")
            {
              using (SolidBrush brush = new SolidBrush(mark.White ? InkBlack : PaperGray))
                FillRound(canvas, brush, mark.X, mark.Y, mark.W, mark.H, mark.Radius);
            }
            else
            {
              TextFormatFlags flags = DrawFlags(mark.Rtl, false);
              Rectangle rect = new Rectangle(mark.X, mark.Y, mark.W, mark.H + 4);
              Color fore = mark.White ? Color.White : Color.Black;
              // Omit the back color so GDI does not paint a white rectangle over the gray bars.
              TextRenderer.DrawText(canvas, mark.Text, mark.Font, rect, fore, flags);
            }
          }
          canvas.Dispose();
          if (!RememberInk(page, drawn)) { drawn.Error = "invalid_layout"; page.Dispose(); return drawn; }
          drawn.Pages.Add(page);
        }
        drawn.PageWidth = pageW;
        drawn.PageHeight = sheet.Heights[0];
        drawn.MaxPage = maxPage;
      }
      finally
      {
        measure.Dispose();
        scratch.Dispose();
      }
      return drawn;
    }

    static void FillRound(Graphics canvas, Brush brush, int x, int y, int w, int h, int radius)
    {
      int r = Math.Max(1, Math.Min(radius, Math.Min(w, h) / 2));
      using (GraphicsPath path = new GraphicsPath())
      {
        path.AddArc(x, y, r * 2, r * 2, 180, 90);
        path.AddArc(x + w - r * 2, y, r * 2, r * 2, 270, 90);
        path.AddArc(x + w - r * 2, y + h - r * 2, r * 2, r * 2, 0, 90);
        path.AddArc(x, y + h - r * 2, r * 2, r * 2, 90, 90);
        path.CloseFigure();
        canvas.FillPath(brush, path);
      }
    }

    static string Submit(Job job, List<Bitmap> pages, PrintAttempt attempt)
    {
      bool invoked = false;
      PrintDocument document = new PrintDocument();
      try
      {
        document.PrintController = new StandardPrintController();
        document.DocumentName = job.Kind == "label" ? "Bravos label" : "Bravos receipt";
        document.OriginAtMargins = false;
        document.PrinterSettings.PrintToFile = false;
        document.PrinterSettings.PrinterName = job.Kind == "label" ? LabelPrinter : ReceiptPrinter;
        if (!document.PrinterSettings.IsValid) return Fail("printer_missing");
        PrinterResolution resolution = FindResolution(document.PrinterSettings);
        if (resolution == null) return Fail("unsupported_driver");
        document.DefaultPageSettings.PrinterResolution = resolution;
        if (job.Copies > document.PrinterSettings.MaximumCopies) return Fail("invalid_layout");
        document.PrinterSettings.Copies = (short)job.Copies;
        document.PrinterSettings.Collate = false;
        document.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
        document.DefaultPageSettings.Landscape = false;
        int[] shiftX = new int[pages.Count];
        int[] shiftY = new int[pages.Count];
        for (int i = 0; i < pages.Count; i++)
        {
          ApplyPaper(document.DefaultPageSettings, pages[i].Width, pages[i].Height, resolution);
          string geometry = CheckPage(document, pages[i], out shiftX[i], out shiftY[i]);
          if (geometry != null) return Fail(geometry);
        }
        int pageIndex = 0;
        document.QueryPageSettings += delegate(object sender, QueryPageSettingsEventArgs args)
        {
          ApplyPaper(args.PageSettings, pages[pageIndex].Width, pages[pageIndex].Height, resolution);
        };
        document.PrintPage += delegate(object sender, PrintPageEventArgs args)
        {
          args.Graphics.PageUnit = GraphicsUnit.Pixel;
          args.Graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
          args.Graphics.PixelOffsetMode = PixelOffsetMode.None;
          args.Graphics.DrawImageUnscaled(pages[pageIndex], -shiftX[pageIndex], -shiftY[pageIndex]);
          pageIndex++;
          args.HasMorePages = pageIndex < pages.Count;
        };
        invoked = true;
        if (attempt != null) attempt.PrintMayHaveRun = true;
        document.Print();
        return "{\"ok\":true,\"outcome\":\"submitted\",\"printInvoked\":true}";
      }
      catch
      {
        if (invoked) return "{\"ok\":false,\"outcome\":\"unknown\",\"printInvoked\":true}";
        return Fail("renderer_unavailable");
      }
      finally
      {
        document.Dispose();
      }
    }

    static string CheckPage(PrintDocument document, Bitmap page, out int hardX, out int hardY)
    {
      hardX = 0;
      hardY = 0;
      int printableW;
      int printableH;
      if (!ToDots(document.DefaultPageSettings.HardMarginX, out hardX)) return "invalid_layout";
      if (!ToDots(document.DefaultPageSettings.HardMarginY, out hardY)) return "invalid_layout";
      if (!ToDots(document.DefaultPageSettings.PrintableArea.Width, out printableW)) return "invalid_layout";
      if (!ToDots(document.DefaultPageSettings.PrintableArea.Height, out printableH)) return "invalid_layout";
      int paperW;
      int paperH;
      if (!ToDots(document.DefaultPageSettings.PaperSize.Width, out paperW)) return "invalid_layout";
      if (!ToDots(document.DefaultPageSettings.PaperSize.Height, out paperH)) return "invalid_layout";
      if (paperW < page.Width || paperW - page.Width > 1) return "invalid_layout";
      if (paperH < page.Height || paperH - page.Height > 1) return "invalid_layout";
      using (Graphics graphics = document.PrinterSettings.CreateMeasurementGraphics())
      {
        if (Math.Abs(graphics.DpiX - Dpi) > 0.2f || Math.Abs(graphics.DpiY - Dpi) > 0.2f) return "unsupported_driver";
      }
      int minX;
      int minY;
      int maxX;
      int maxY;
      if (!TryInk(page, out minX, out minY, out maxX, out maxY)) return "invalid_layout";
      if (minX < hardX || minY < hardY) return "invalid_layout";
      if (maxX >= hardX + printableW || maxY >= hardY + printableH) return "invalid_layout";
      return null;
    }

    static void ApplyPaper(PageSettings page, int widthDots, int heightDots, PrinterResolution resolution)
    {
      PaperSize size = new PaperSize("Bravos", Hundredths(widthDots), Hundredths(heightDots));
      size.RawKind = (int)PaperKind.Custom;
      page.PaperSize = size;
      page.Margins = new Margins(0, 0, 0, 0);
      page.Landscape = false;
      page.PrinterResolution = resolution;
    }

    static PrinterResolution FindResolution(PrinterSettings settings)
    {
      foreach (PrinterResolution resolution in settings.PrinterResolutions)
      {
        if (resolution.X == Dpi && resolution.Y == Dpi) return resolution;
      }
      return null;
    }

    static string PreviewJson(Job job, Drawn drawn)
    {
      StringBuilder builder = new StringBuilder();
      builder.Append("{\"ok\":true,\"outcome\":\"preview\",\"printInvoked\":false");
      builder.Append(",\"kind\":\"").Append(job.Kind).Append('"');
      builder.Append(",\"copies\":").Append(job.Copies.ToString(CultureInfo.InvariantCulture));
      builder.Append(",\"dpi\":203");
      AppendNullable(builder, "moduleDots", drawn.ModuleDots);
      AppendNullable(builder, "quietModules", job.Kind == "label" ? QuietModules : -1);
      AppendNullable(builder, "barcodeModules", drawn.BarcodeModules);
      AppendNullable(builder, "barcodeWidthDots", drawn.BarcodeWidth);
      AppendNullable(builder, "barHeightDots", drawn.BarHeight);
      builder.Append(",\"pageWidthDots\":").Append(drawn.PageWidth.ToString(CultureInfo.InvariantCulture));
      builder.Append(",\"pageHeightDots\":").Append(drawn.PageHeight.ToString(CultureInfo.InvariantCulture));
      AppendNullable(builder, "maxPageHeightDots", drawn.MaxPage);
      builder.Append(",\"pages\":[");
      for (int i = 0; i < drawn.Pages.Count; i++)
      {
        if (i > 0) builder.Append(',');
        string png = Png(drawn.Pages[i]);
        if (png == null) return Fail("invalid_layout");
        InkBox ink = drawn.Inks[i];
        builder.Append("{\"widthDots\":").Append(drawn.Pages[i].Width.ToString(CultureInfo.InvariantCulture));
        builder.Append(",\"heightDots\":").Append(drawn.Pages[i].Height.ToString(CultureInfo.InvariantCulture));
        builder.Append(",\"pngBase64\":\"").Append(png).Append('"');
        builder.Append(",\"ink\":{\"minX\":").Append(ink.MinX.ToString(CultureInfo.InvariantCulture));
        builder.Append(",\"minY\":").Append(ink.MinY.ToString(CultureInfo.InvariantCulture));
        builder.Append(",\"maxX\":").Append(ink.MaxX.ToString(CultureInfo.InvariantCulture));
        builder.Append(",\"maxY\":").Append(ink.MaxY.ToString(CultureInfo.InvariantCulture)).Append("}}");
      }
      builder.Append("],\"lines\":[");
      for (int i = 0; i < drawn.Lines.Count; i++)
      {
        if (i > 0) builder.Append(',');
        TextLine line = drawn.Lines[i];
        string text = Quote(line.Text);
        string role = Quote(line.Role);
        if (text == null || role == null) return Fail("invalid_layout");
        builder.Append("{\"page\":").Append(line.Page.ToString(CultureInfo.InvariantCulture));
        builder.Append(",\"role\":").Append(role);
        builder.Append(",\"text\":").Append(text);
        builder.Append(",\"x\":").Append(line.X.ToString(CultureInfo.InvariantCulture));
        builder.Append(",\"y\":").Append(line.Y.ToString(CultureInfo.InvariantCulture));
        builder.Append(",\"w\":").Append(line.W.ToString(CultureInfo.InvariantCulture));
        builder.Append(",\"h\":").Append(line.H.ToString(CultureInfo.InvariantCulture));
        builder.Append(",\"clipped\":false}");
      }
      builder.Append("]}");
      return builder.ToString();
    }

    static void AppendNullable(StringBuilder builder, string name, int value)
    {
      builder.Append(",\"").Append(name).Append("\":");
      if (value < 0) builder.Append("null");
      else builder.Append(value.ToString(CultureInfo.InvariantCulture));
    }

    static bool DrawCentered(Graphics canvas, List<string> lines, Font font, int left, int width, ref int y, bool rtl, Drawn drawn, int page, string role)
    {
      TextFormatFlags flags = DrawFlags(rtl, true);
      for (int i = 0; i < lines.Count; i++)
      {
        Size size = TextRenderer.MeasureText(canvas, lines[i], font, new Size(int.MaxValue, int.MaxValue), MeasureFlags(rtl));
        if (size.Width > width || size.Height < 1) return false;
        Rectangle rect = new Rectangle(left, y, width, size.Height + 4);
        TextRenderer.DrawText(canvas, lines[i], font, rect, Color.Black, Color.White, flags);
        drawn.Lines.Add(new TextLine(page, role, lines[i], left, y, width, size.Height));
        y += size.Height + 2;
      }
      return true;
    }

    static bool DrawStart(Graphics canvas, List<string> lines, Font font, int left, int width, ref int y, bool rtl, Drawn drawn, int page, string role)
    {
      TextFormatFlags flags = MeasureFlags(rtl);
      for (int i = 0; i < lines.Count; i++)
      {
        Size size = TextRenderer.MeasureText(canvas, lines[i], font, new Size(int.MaxValue, int.MaxValue), flags);
        if (size.Width > width || size.Height < 1) return false;
        Rectangle rect = new Rectangle(left, y, width, size.Height + 4);
        TextRenderer.DrawText(canvas, lines[i], font, rect, Color.Black, Color.White, flags);
        drawn.Lines.Add(new TextLine(page, role, lines[i], left, y, size.Width, size.Height));
        y += size.Height + 2;
      }
      return true;
    }

    static bool DrawEnd(Graphics canvas, List<string> lines, Font font, int left, int width, ref int y, Drawn drawn, int page, string role)
    {
      TextFormatFlags flags = MeasureFlags(false);
      for (int i = 0; i < lines.Count; i++)
      {
        Size size = TextRenderer.MeasureText(canvas, lines[i], font, new Size(int.MaxValue, int.MaxValue), flags);
        if (size.Width > width || size.Height < 1) return false;
        int x = left + width - size.Width;
        Rectangle rect = new Rectangle(x, y, size.Width + 2, size.Height + 4);
        TextRenderer.DrawText(canvas, lines[i], font, rect, Color.Black, Color.White, flags);
        drawn.Lines.Add(new TextLine(page, role, lines[i], x, y, size.Width, size.Height));
        y += size.Height + 2;
      }
      return true;
    }

    static int BlockHeight(Graphics measure, List<string> lines, Font font, bool rtl)
    {
      int height = 0;
      for (int i = 0; i < lines.Count; i++)
      {
        Size size = TextRenderer.MeasureText(measure, lines[i], font, new Size(int.MaxValue, int.MaxValue), MeasureFlags(rtl));
        if (size.Width < 1 || size.Height < 1) return -1;
        height += size.Height + 2;
      }
      return height;
    }

    static List<string> Wrap(Graphics measure, string text, Font font, int maxWidth, bool rtl)
    {
      if (text == null || text.Length == 0) return null;
      List<string> lines = new List<string>();
      string rest = text;
      TextFormatFlags flags = MeasureFlags(rtl);
      int guard = 0;
      while (rest.Length > 0)
      {
        guard++;
        if (guard > 20) return null;
        int count = Fit(measure, rest, font, maxWidth, flags);
        if (count <= 0) return null;
        if (count < rest.Length)
        {
          int space = rest.LastIndexOf(' ', count - 1, count);
          if (space > 0) count = space;
        }
        string line = rest.Substring(0, count);
        if (line.Length > 0 && line[line.Length - 1] == ' ') line = line.Substring(0, line.Length - 1);
        if (line.Length == 0) return null;
        Size size = TextRenderer.MeasureText(measure, line, font, new Size(int.MaxValue, int.MaxValue), flags);
        if (size.Width > maxWidth) return null;
        lines.Add(line);
        if (count >= rest.Length) break;
        rest = rest.Substring(count);
        if (rest.Length > 0 && rest[0] == ' ') rest = rest.Substring(1);
      }
      return lines.Count > 0 ? lines : null;
    }

    static int Fit(Graphics measure, string text, Font font, int maxWidth, TextFormatFlags flags)
    {
      int lo = 1;
      int hi = text.Length;
      int best = 0;
      while (lo <= hi)
      {
        int mid = (lo + hi) / 2;
        Size size = TextRenderer.MeasureText(measure, text.Substring(0, mid), font, new Size(int.MaxValue, int.MaxValue), flags);
        if (size.Width <= maxWidth) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      return best;
    }

    static bool Calibrate(Graphics measure, Font font)
    {
      Size size = TextRenderer.MeasureText(measure, "M", font, new Size(int.MaxValue, int.MaxValue), MeasureFlags(false));
      return size.Height >= font.Size * 0.5f && size.Height <= font.Size * 2.5f && size.Width > 0;
    }

    static TextFormatFlags MeasureFlags(bool rtl)
    {
      TextFormatFlags flags = TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.NoClipping | TextFormatFlags.Top;
      if (rtl) flags |= TextFormatFlags.RightToLeft | TextFormatFlags.Right;
      return flags;
    }

    static TextFormatFlags DrawFlags(bool rtl, bool center)
    {
      TextFormatFlags flags = MeasureFlags(rtl);
      if (center) flags |= TextFormatFlags.HorizontalCenter;
      return flags;
    }

    static bool HasArabic(string text)
    {
      if (text == null) return false;
      for (int i = 0; i < text.Length; i++)
      {
        char c = text[i];
        if (c >= '\u0600' && c <= '\u06FF') return true;
        if (c >= '\u0750' && c <= '\u077F') return true;
        if (c >= '\u08A0' && c <= '\u08FF') return true;
        if (c >= '\uFB50' && c <= '\uFDFF') return true;
        if (c >= '\uFE70' && c <= '\uFEFF') return true;
      }
      return false;
    }

    static bool RememberInk(Bitmap page, Drawn drawn)
    {
      int minX;
      int minY;
      int maxX;
      int maxY;
      if (!TryInk(page, out minX, out minY, out maxX, out maxY)) return false;
      if (minX < 0 || minY < 0 || maxX >= page.Width || maxY >= page.Height) return false;
      drawn.Inks.Add(new InkBox(minX, minY, maxX, maxY));
      return true;
    }

    static bool TryInk(Bitmap bmp, out int minX, out int minY, out int maxX, out int maxY)
    {
      minX = bmp.Width;
      minY = bmp.Height;
      maxX = -1;
      maxY = -1;
      BitmapData data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
      try
      {
        if (data.Stride <= 0) return false;
        int bytes = data.Stride * bmp.Height;
        byte[] raw = new byte[bytes];
        Marshal.Copy(data.Scan0, raw, 0, bytes);
        for (int y = 0; y < bmp.Height; y++)
        {
          int row = y * data.Stride;
          for (int x = 0; x < bmp.Width; x++)
          {
            int index = row + x * 3;
            if (raw[index] < 250 || raw[index + 1] < 250 || raw[index + 2] < 250)
            {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }
      }
      finally
      {
        bmp.UnlockBits(data);
      }
      return maxX >= 0;
    }

    static string Png(Bitmap bmp)
    {
      using (MemoryStream stream = new MemoryStream())
      {
        bmp.Save(stream, ImageFormat.Png);
        if (stream.Length < 32 || stream.Length > 720000) return null;
        return Convert.ToBase64String(stream.ToArray());
      }
    }

    static int Mm(double mm)
    {
      return (int)Math.Floor(mm * Dpi / 25.4 + 0.5);
    }

    static int Hundredths(int dots)
    {
      return (int)Math.Floor(dots * 100.0 / Dpi + 0.5);
    }

    static bool ToDots(double hundredths, out int dots)
    {
      double exact = hundredths * Dpi / 100.0;
      dots = (int)Math.Floor(exact + 0.5);
      // 38 mm is 304 dots, which PaperSize stores as 150 hundredths and reads back as 304.5.
      return dots >= 0 && Math.Abs(exact - dots) <= 0.5 + 1e-6;
    }

    static bool TrustedAsset(string path, string fileName)
    {
      try
      {
        if (path == null || path.IndexOf("..", StringComparison.Ordinal) >= 0) return false;
        string full = Path.GetFullPath(path);
        string tail = "\\apps\\print-connector\\assets\\" + fileName;
        if (full.IndexOf(tail, StringComparison.OrdinalIgnoreCase) < 0) return false;
        if (!full.EndsWith(fileName, StringComparison.OrdinalIgnoreCase)) return false;
        return File.Exists(full);
      }
      catch
      {
        return false;
      }
    }

    static bool DeviceMatches(string role, string port, string id, string status)
    {
      if (status == null || !status.Equals("OK", StringComparison.OrdinalIgnoreCase)) return false;
      if (id == null || port == null) return false;
      string upper = id.ToUpperInvariant();
      string token = port.ToUpperInvariant();
      if (!upper.StartsWith("USBPRINT\\", StringComparison.Ordinal)) return false;
      if (!upper.EndsWith("\\" + token, StringComparison.Ordinal) && !upper.EndsWith("&" + token, StringComparison.Ordinal)) return false;
      if (role == "label") return upper.IndexOf("\\XPRINTERXP-236B\\", StringComparison.Ordinal) >= 0;
      if (upper.IndexOf("236B", StringComparison.Ordinal) >= 0) return false;
      return upper.StartsWith("USBPRINT\\PRINTERPOS-80\\", StringComparison.Ordinal)
        || upper.IndexOf("XPRINTERXP-80", StringComparison.Ordinal) >= 0
        || upper.IndexOf("XP-80", StringComparison.Ordinal) >= 0
        || upper.IndexOf("XP80", StringComparison.Ordinal) >= 0;
    }

    static bool StatusAllows(string status)
    {
      if (status == null) return false;
      string value = status.Trim().ToLowerInvariant();
      return value == "normal" || value == "0" || value == "busy" || value == "printing"
        || value == "ioactive" || value == "processing" || value == "waiting"
        || value == "warmingup" || value == "initializing" || value == "powersave";
    }

    static bool IsUsbPort(string port)
    {
      if (port == null || port.Length != 6) return false;
      if (port[0] != 'U' || port[1] != 'S' || port[2] != 'B') return false;
      for (int i = 3; i < 6; i++)
      {
        if (port[i] < '0' || port[i] > '9') return false;
      }
      return true;
    }

    static string Fail(string code)
    {
      if (code != "printer_missing" && code != "printer_offline" && code != "unsupported_driver"
        && code != "renderer_unavailable" && code != "invalid_layout" && code != "invalid_job")
      {
        code = "renderer_unavailable";
      }
      return "{\"ok\":false,\"outcome\":\"failed\",\"code\":\"" + code + "\",\"printInvoked\":false}";
    }

    static string Quote(string value)
    {
      if (value == null) return "\"\"";
      StringBuilder builder = new StringBuilder();
      builder.Append('"');
      for (int i = 0; i < value.Length; i++)
      {
        char c = value[i];
        if (c == '"' || c == '\\') builder.Append('\\').Append(c);
        else if (c < 32 || c == '\u007f') return null;
        else builder.Append(c);
      }
      builder.Append('"');
      return builder.ToString();
    }

    static string SafeToken(string value, int max, bool allowSpace)
    {
      if (value == null) return "";
      string text = value.Trim();
      if (text.Length > max) return "";
      for (int i = 0; i < text.Length; i++)
      {
        char c = text[i];
        bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-';
        if (allowSpace && c == ' ') ok = true;
        if (!ok) return "";
      }
      return text;
    }

    static string SafeDevice(string value)
    {
      if (value == null || value.Length < 12 || value.Length > 180) return null;
      for (int i = 0; i < value.Length; i++)
      {
        char c = value[i];
        bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
          || c == '\\' || c == '&' || c == '_' || c == '.' || c == ':' || c == '+' || c == '-';
        if (!ok) return null;
      }
      return value;
    }

    static string Parse(string json, out Job job)
    {
      job = null;
      if (json == null || json.Length < 2 || json.Length > 48000) return "invalid_job";
      JavaScriptSerializer serializer = new JavaScriptSerializer();
      serializer.MaxJsonLength = 48000;
      serializer.RecursionLimit = 8;
      object parsed = serializer.DeserializeObject(json);
      Dictionary<string, object> root = parsed as Dictionary<string, object>;
      if (!Keys(root, "action", "job")) return "invalid_job";
      string action = root["action"] as string;
      if (action != "probe" && action != "preview" && action != "print") return "invalid_job";
      if (action == "probe")
      {
        if (root["job"] != null) return "invalid_job";
        job = new Job();
        job.Action = "probe";
        return null;
      }
      Dictionary<string, object> body = root["job"] as Dictionary<string, object>;
      if (body == null) return "invalid_job";
      string kind = body.ContainsKey("kind") ? body["kind"] as string : null;
      if (kind == "label") return ParseLabel(action, body, out job);
      if (kind == "receipt") return ParseReceipt(action, body, out job);
      return "invalid_job";
    }

    static string ParseLabel(string action, Dictionary<string, object> body, out Job job)
    {
      job = null;
      bool withPrice = Keys(body, "kind", "copies", "code", "name", "modules", "price");
      if (!withPrice && !Keys(body, "kind", "copies", "code", "name", "modules")) return "invalid_job";
      int copies;
      if (!TryInt(body["copies"], 1, 100, out copies)) return "invalid_job";
      string code = body["code"] as string;
      string name = body["name"] as string;
      string modules = body["modules"] as string;
      if (!IsCode(code) || !IsDisplay(name, 80) || !IsModules(modules)) return "invalid_job";
      string price = null;
      if (withPrice && !TryMoney(body["price"], out price)) return "invalid_job";
      job = new Job();
      job.Action = action;
      job.Kind = "label";
      job.Copies = copies;
      job.Code = code;
      job.Name = name;
      job.Modules = modules;
      job.Price = price;
      return null;
    }

    static string ParseReceipt(string action, Dictionary<string, object> body, out Job job)
    {
      job = null;
      if (!Keys(body,
        "kind", "copies", "branchName", "contactPhone", "printedReference", "occurredAtLabel",
        "cashierDisplayName", "customerName", "customerPhone", "lines", "adjustments",
        "finalTotal", "exchangeCredit", "cashCollected", "paymentMethodLabel", "paymentAllocations"))
      {
        return "invalid_job";
      }
      int copies;
      if (!TryInt(body["copies"], 1, 1, out copies)) return "invalid_job";
      string branch = body["branchName"] as string;
      string printed = body["printedReference"] as string;
      string occurred = body["occurredAtLabel"] as string;
      string cashier = body["cashierDisplayName"] as string;
      string customer = body["customerName"] as string;
      string method = body["paymentMethodLabel"] as string;
      if (!IsDisplay(branch, 80) || !IsDisplay(printed, 256) || !IsDisplay(cashier, 80) || !IsDisplay(customer, 120)) return "invalid_job";
      if (!IsDisplay(occurred, 80) || !IsMoney(body["finalTotal"])) return "invalid_job";
      string contact;
      string phone;
      string exchange;
      string collected;
      if (!TryPhone(body["contactPhone"], out contact) || !TryPhone(body["customerPhone"], out phone)) return "invalid_job";
      if (!TryMoney(body["exchangeCredit"], out exchange) || !TryMoney(body["cashCollected"], out collected)) return "invalid_job";
      if ((exchange == null) != (collected == null)) return "invalid_job";
      if (method != "نقدي" && method != "دفع إلكتروني" && method != "مقسّم نقدي وإلكتروني") return "invalid_job";
      List<ItemLine> lines = ParseLines(body["lines"]);
      List<MoneyLine> adjustments = ParseAdjustments(body["adjustments"]);
      List<MoneyLine> allocations = ParseAllocations(method, body["paymentAllocations"]);
      if (lines == null || adjustments == null || allocations == null) return "invalid_job";
      job = new Job();
      job.Action = action;
      job.Kind = "receipt";
      job.Copies = copies;
      job.BranchName = branch;
      job.ContactPhone = contact;
      job.PrintedReference = printed;
      job.OccurredAt = occurred;
      job.Cashier = cashier;
      job.CustomerName = customer;
      job.CustomerPhone = phone;
      job.Lines = lines;
      job.Adjustments = adjustments;
      job.FinalTotal = body["finalTotal"] as string;
      job.ExchangeCredit = exchange;
      job.CashCollected = collected;
      job.PaymentMethod = method;
      job.Allocations = allocations;
      return null;
    }

    static List<ItemLine> ParseLines(object value)
    {
      IList list = value as IList;
      if (list == null || list.Count < 1 || list.Count > 40) return null;
      List<ItemLine> lines = new List<ItemLine>();
      for (int i = 0; i < list.Count; i++)
      {
        Dictionary<string, object> row = list[i] as Dictionary<string, object>;
        if (!Keys(row, "productName", "productCode", "sizeName", "colorName", "quantityAndUnitPrice", "lineOriginal", "linePaid")) return null;
        string name = row["productName"] as string;
        string code = row["productCode"] as string;
        string size = row["sizeName"] as string;
        string color = row["colorName"] as string;
        string qty = row["quantityAndUnitPrice"] as string;
        if (!IsDisplay(name, 80) || (size != "" && !IsDisplay(size, 80)) || (color != "" && !IsDisplay(color, 80))) return null;
        if (code == null || (code.Length != 0 && !IsCode(code))) return null;
        if (!Quantity.IsMatch(qty) || !IsMoney(row["lineOriginal"])) return null;
        string paid;
        if (!TryMoney(row["linePaid"], out paid)) return null;
        ItemLine line = new ItemLine();
        line.Name = name;
        line.Qty = qty;
        line.Original = row["lineOriginal"] as string;
        line.Paid = paid;
        lines.Add(line);
      }
      return lines;
    }

    static List<MoneyLine> ParseAdjustments(object value)
    {
      IList list = value as IList;
      if (list == null || list.Count > 4) return null;
      List<MoneyLine> rows = new List<MoneyLine>();
      for (int i = 0; i < list.Count; i++)
      {
        Dictionary<string, object> row = list[i] as Dictionary<string, object>;
        if (!Keys(row, "label", "amount") || !IsMoney(row["amount"])) return null;
        string label = row["label"] as string;
        if (label != "الإجمالي قبل الخصم" && label != "خصم العرض" && label != "خصم الكوبون" && label != "خصم الموظف") return null;
        for (int seen = 0; seen < rows.Count; seen++) if (rows[seen].Label == label) return null;
        MoneyLine money = new MoneyLine();
        money.Label = label;
        money.Amount = row["amount"] as string;
        rows.Add(money);
      }
      return rows;
    }

    static List<MoneyLine> ParseAllocations(string method, object value)
    {
      IList list = value as IList;
      if (list == null) return null;
      List<MoneyLine> rows = new List<MoneyLine>();
      for (int i = 0; i < list.Count; i++)
      {
        Dictionary<string, object> row = list[i] as Dictionary<string, object>;
        if (!Keys(row, "label", "amount") || !IsMoney(row["amount"])) return null;
        string label = row["label"] as string;
        if (label == null) return null;
        MoneyLine money = new MoneyLine();
        money.Label = label;
        money.Amount = row["amount"] as string;
        rows.Add(money);
      }
      if (method == "نقدي")
      {
        if (rows.Count != 1 || rows[0].Label != "المبلغ النقدي") return null;
        return rows;
      }
      if (method == "دفع إلكتروني")
      {
        if (rows.Count != 1 || rows[0].Label != "المبلغ الإلكتروني") return null;
        return rows;
      }
      if (rows.Count != 2 || rows[0].Label != "المبلغ النقدي" || rows[1].Label != "المبلغ الإلكتروني") return null;
      return rows;
    }

    static bool Keys(Dictionary<string, object> record, params string[] keys)
    {
      if (record == null || record.Count != keys.Length) return false;
      for (int i = 0; i < keys.Length; i++)
      {
        if (!record.ContainsKey(keys[i])) return false;
      }
      return true;
    }

    static bool TryInt(object value, int min, int max, out int number)
    {
      number = 0;
      if (value is int) number = (int)value;
      else if (value is long)
      {
        long wide = (long)value;
        if (wide < -2147483648L || wide > 2147483647L) return false;
        number = (int)wide;
      }
      else if (value is decimal)
      {
        decimal amount = (decimal)value;
        if (amount != Math.Truncate(amount) || amount < -2147483648m || amount > 2147483647m) return false;
        number = (int)amount;
      }
      else return false;
      return number >= min && number <= max;
    }

    static bool TryPhone(object value, out string phone)
    {
      phone = null;
      if (value == null) return true;
      phone = value as string;
      return phone != null && IsDisplay(phone, 40);
    }

    static bool TryMoney(object value, out string money)
    {
      money = null;
      if (value == null) return true;
      money = value as string;
      return money != null && Money.IsMatch(money);
    }

    static bool IsMoney(object value)
    {
      string text = value as string;
      return text != null && Money.IsMatch(text);
    }

    static bool IsCode(string value)
    {
      if (value == null || value.Length < 1 || value.Length > 40) return false;
      for (int i = 0; i < value.Length; i++)
      {
        char c = value[i];
        bool alpha = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
        bool mark = c == '.' || c == '_' || c == '-';
        if (i == 0 && !alpha) return false;
        if (!alpha && !mark) return false;
      }
      return true;
    }

    static bool IsModules(string value)
    {
      if (value == null || value.Length < 35 || value.Length > 520 || (value.Length - 35) % 11 != 0) return false;
      for (int i = 0; i < value.Length; i++)
      {
        if (value[i] != '0' && value[i] != '1') return false;
      }
      return true;
    }

    static bool IsDisplay(string value, int max)
    {
      if (value == null || value.Length < 1 || value.Length > max || value.Length > 4000) return false;
      for (int i = 0; i < value.Length; i++)
      {
        char c = value[i];
        if (c <= '\u001F' || c == '\u007F') return false;
        if (c >= '\u202A' && c <= '\u202E') return false;
        if (c >= '\u2066' && c <= '\u2069') return false;
      }
      return true;
    }
  }

  sealed class PrintAttempt
  {
    public bool PrintMayHaveRun;
  }

  sealed class Job
  {
    public string Action;
    public string Kind;
    public int Copies;
    public string Code;
    public string Name;
    public string Modules;
    public string Price;
    public string BranchName;
    public string ContactPhone;
    public string PrintedReference;
    public string OccurredAt;
    public string Cashier;
    public string CustomerName;
    public string CustomerPhone;
    public List<ItemLine> Lines;
    public List<MoneyLine> Adjustments;
    public string FinalTotal;
    public string ExchangeCredit;
    public string CashCollected;
    public string PaymentMethod;
    public List<MoneyLine> Allocations;
  }

  sealed class ItemLine
  {
    public string Name;
    public string Qty;
    public string Original;
    public string Paid;
  }

  sealed class MoneyLine
  {
    public string Label;
    public string Amount;
  }

  sealed class TextLine
  {
    public int Page;
    public string Role;
    public string Text;
    public int X;
    public int Y;
    public int W;
    public int H;
    public TextLine(int page, string role, string text, int x, int y, int w, int h)
    {
      Page = page;
      Role = role;
      Text = text;
      X = x;
      Y = y;
      W = w;
      H = h;
    }
  }

  sealed class InkBox
  {
    public int MinX;
    public int MinY;
    public int MaxX;
    public int MaxY;
    public InkBox(int minX, int minY, int maxX, int maxY)
    {
      MinX = minX;
      MinY = minY;
      MaxX = maxX;
      MaxY = maxY;
    }
  }

  sealed class Mark
  {
    public int Page;
    public int X;
    public int Y;
    public int W;
    public int H;
    public string Text;
    public string Role;
    public Font Font;
    public bool Rtl;
    public string Kind;
    public int Radius;
    public bool White;
  }

  sealed class Drawn
  {
    public List<Bitmap> Pages = new List<Bitmap>();
    public List<TextLine> Lines = new List<TextLine>();
    public List<InkBox> Inks = new List<InkBox>();
    public string Error;
    public int ModuleDots = -1;
    public int BarcodeModules = -1;
    public int BarcodeWidth = -1;
    public int BarHeight = -1;
    public int PageWidth;
    public int PageHeight;
    public int MaxPage = -1;
  }

  sealed class Sheet
  {
    public List<Mark> Marks = new List<Mark>();
    public int[] Heights = new int[6];
    public int PageCount;
    public int Page;
    public int Y;
    public int PageW;
    public int TextLeft;
    public int TextW;
    public int Top;
    public int Bottom;
    public int Max;
    public string Error;

    public void AddLogo(int width, int height, int x)
    {
      int block = height + Mm(1);
      if (!Ensure(block)) return;
      Mark mark = new Mark();
      mark.Kind = "logo";
      mark.Page = Page;
      mark.X = x;
      mark.Y = Y;
      mark.W = width;
      mark.H = height;
      Marks.Add(mark);
      Y += block;
    }

    public bool AddCentered(Graphics measure, string role, string text, Font font, bool rtl, Drawn drawn)
    {
      Size size = TextRenderer.MeasureText(measure, text, font, new Size(int.MaxValue, int.MaxValue), HostMeasure(rtl));
      if (size.Width < 1 || size.Height < 1 || size.Width > TextW) { Error = "invalid_layout"; return false; }
      int height = size.Height + 2;
      if (!Ensure(height)) { Error = Error ?? "invalid_layout"; return false; }
      int x = TextLeft + (TextW - size.Width) / 2;
      AddText(role, text, font, rtl, x, Y, size, drawn);
      Y += height;
      return true;
    }

    public bool AddMeta(Graphics measure, Font font, Drawn drawn,
      string invoice, string date, string time, string cashier, string customer, string phone)
    {
      int gap = Mm(1);
      int rightW = TextW * 55 / 100;
      int leftW = TextW - rightW - gap;
      if (leftW < 8 || rightW < 8) { Error = "invalid_layout"; return false; }
      int rightX = TextLeft + leftW + gap;
      int leftX = TextLeft;
      List<string[]> rightRows = new List<string[]>();
      rightRows.Add(new[] { "رقم الفاتورة:", invoice });
      rightRows.Add(new[] { "التاريخ:", date });
      if (time != null) rightRows.Add(new[] { "الوقت:", time });
      List<string[]> leftRows = new List<string[]>();
      leftRows.Add(new[] { "الكاشير:", cashier });
      leftRows.Add(new[] { "العميل:", customer });
      if (phone != null) leftRows.Add(new[] { "الهاتف:", phone });
      int rightH = MeasureColonColumn(measure, font, rightRows, rightW);
      int leftH = MeasureColonColumn(measure, font, leftRows, leftW);
      if (rightH < 1 || leftH < 1) { Error = "invalid_layout"; return false; }
      int block = Math.Max(rightH, leftH) + Mm(2);
      if (!Ensure(block)) { Error = Error ?? "invalid_layout"; return false; }
      AddRuleAt(Y);
      Y += Mm(1);
      int start = Y;
      DrawColonColumn(measure, font, rightRows, rightX, rightW, drawn, "reference");
      Y = start;
      DrawColonColumn(measure, font, leftRows, leftX, leftW, drawn, "detail");
      Y = start + Math.Max(rightH, leftH);
      AddRuleAt(Y);
      Mark divider = new Mark();
      divider.Kind = "vline";
      divider.Page = Page;
      divider.X = TextLeft + leftW + gap / 2;
      divider.Y = start;
      divider.W = 1;
      divider.H = Math.Max(rightH, leftH);
      Marks.Add(divider);
      Y += Mm(1);
      return true;
    }

    int MeasureColonColumn(Graphics measure, Font font, List<string[]> rows, int width)
    {
      int height = 0;
      for (int i = 0; i < rows.Count; i++)
      {
        int rowH = ColonRowHeight(measure, font, rows[i][0], rows[i][1], width);
        if (rowH < 1) return -1;
        height += rowH;
      }
      return height;
    }

    int ColonRowHeight(Graphics measure, Font font, string label, string value, int width)
    {
      Size labelSize = TextRenderer.MeasureText(measure, label, font, new Size(int.MaxValue, int.MaxValue), HostMeasure(true));
      int valueWidth = width - labelSize.Width - 2;
      if (labelSize.Width < 1 || valueWidth < 8) return -1;
      List<string> lines = HostWrap(measure, value, font, valueWidth, HostArabic(value) || !HostArabic(label));
      if (lines == null) return -1;
      int height = 0;
      foreach (string line in lines)
      {
        Size size = TextRenderer.MeasureText(measure, line, font, new Size(int.MaxValue, int.MaxValue), HostMeasure(HostArabic(line)));
        height += size.Height + 2;
      }
      return Math.Max(height, labelSize.Height + 2);
    }

    void DrawColonColumn(Graphics measure, Font font, List<string[]> rows, int x, int width, Drawn drawn, string role)
    {
      for (int i = 0; i < rows.Count; i++)
      {
        string label = rows[i][0];
        string value = rows[i][1];
        Size labelSize = TextRenderer.MeasureText(measure, label, font, new Size(int.MaxValue, int.MaxValue), HostMeasure(true));
        int valueWidth = width - labelSize.Width - 2;
        List<string> lines = HostWrap(measure, value, font, valueWidth, HostArabic(value));
        int rowTop = Y;
        AddText(role, label, font, true, x + width - labelSize.Width, Y, labelSize, drawn);
        int valueY = Y;
        int firstRight = x + width - labelSize.Width - 2;
        for (int line = 0; line < lines.Count; line++)
        {
          Size size = TextRenderer.MeasureText(measure, lines[line], font, new Size(int.MaxValue, int.MaxValue), HostMeasure(HostArabic(lines[line])));
          int valueX = line == 0 ? firstRight - size.Width : x + width - size.Width;
          AddText(role, lines[line], font, HostArabic(lines[line]), valueX, valueY, size, drawn);
          valueY += size.Height + 2;
        }
        Y = Math.Max(rowTop + labelSize.Height + 2, valueY);
      }
    }

    public bool AddBar(Graphics measure, string role, string label, string amount, Font font, Drawn drawn)
    {
      Size labelSize = TextRenderer.MeasureText(measure, label, font, new Size(int.MaxValue, int.MaxValue), HostMeasure(true));
      Size amountSize = TextRenderer.MeasureText(measure, amount, font, new Size(int.MaxValue, int.MaxValue), HostMeasure(false));
      int height = Math.Max(labelSize.Height, amountSize.Height) + Mm(1.7);
      if (!Ensure(height + Mm(1.6))) { Error = Error ?? "invalid_layout"; return false; }
      Y += Mm(1.6);
      Mark fill = new Mark();
      fill.Kind = "fill";
      fill.Page = Page;
      fill.X = TextLeft;
      fill.Y = Y;
      fill.W = TextW;
      fill.H = height;
      fill.Radius = Mm(1.4);
      Marks.Add(fill);
      int textY = Y + (height - Math.Max(labelSize.Height, amountSize.Height)) / 2;
      AddText(role, label, font, true, TextLeft + TextW - Mm(1.5) - labelSize.Width, textY, labelSize, drawn);
      AddText(role, amount, font, false, TextLeft + Mm(1.5), textY, amountSize, drawn);
      Y += height;
      return true;
    }

    public bool AddPill(Graphics measure, string role, string label, string amount, Font font, Drawn drawn)
    {
      Size labelSize = TextRenderer.MeasureText(measure, label, font, new Size(int.MaxValue, int.MaxValue), HostMeasure(true));
      Size amountSize = TextRenderer.MeasureText(measure, amount, font, new Size(int.MaxValue, int.MaxValue), HostMeasure(false));
      int height = Math.Max(labelSize.Height, amountSize.Height) + Mm(1.7);
      if (!Ensure(height + Mm(1.2))) { Error = Error ?? "invalid_layout"; return false; }
      Y += Mm(1.2);
      Mark fill = new Mark();
      fill.Kind = "fill";
      fill.Page = Page;
      fill.X = TextLeft;
      fill.Y = Y;
      fill.W = TextW;
      fill.H = height;
      fill.Radius = height / 2;
      fill.White = true;
      Marks.Add(fill);
      int textY = Y + (height - Math.Max(labelSize.Height, amountSize.Height)) / 2;
      AddWhiteText(role, label, font, true, TextLeft + TextW - Mm(2.25) - labelSize.Width, textY, labelSize, drawn);
      AddWhiteText(role, amount, font, false, TextLeft + Mm(2.25), textY, amountSize, drawn);
      Y += height;
      return true;
    }

    public bool AddFooter(Graphics measure, string role, string text, Font font, Drawn drawn)
    {
      Size size = TextRenderer.MeasureText(measure, text, font, new Size(int.MaxValue, int.MaxValue), HostMeasure(true));
      if (size.Width < 1 || size.Width + Mm(8) > TextW) { Error = "invalid_layout"; return false; }
      int height = size.Height + Mm(2.8);
      if (!Ensure(height)) { Error = Error ?? "invalid_layout"; return false; }
      Y += Mm(2.8);
      int textX = TextLeft + (TextW - size.Width) / 2;
      AddRuleSegment(TextLeft, textX - Mm(2));
      AddRuleSegment(textX + size.Width + Mm(2), TextLeft + TextW);
      AddText(role, text, font, true, textX, Y, size, drawn);
      Y += size.Height + 2;
      return true;
    }

    public void AddRule()
    {
      AddRuleAt(Y + Mm(0.6));
      Y += Mm(1.2);
    }

    void AddRuleAt(int y)
    {
      Mark mark = new Mark();
      mark.Kind = "rule";
      mark.Page = Page;
      mark.X = TextLeft;
      mark.Y = y;
      mark.W = TextW;
      Marks.Add(mark);
    }

    void AddRuleSegment(int x1, int x2)
    {
      if (x2 <= x1) return;
      Mark mark = new Mark();
      mark.Kind = "rule";
      mark.Page = Page;
      mark.X = x1;
      mark.Y = Y + 4;
      mark.W = x2 - x1;
      Marks.Add(mark);
    }

    void AddWhiteText(string role, string text, Font font, bool rtl, int x, int y, Size size, Drawn drawn)
    {
      Mark mark = new Mark();
      mark.Kind = "text";
      mark.Page = Page;
      mark.Role = role;
      mark.Text = text;
      mark.Font = font;
      mark.Rtl = rtl;
      mark.White = true;
      mark.X = x;
      mark.Y = y;
      mark.W = size.Width + 2;
      mark.H = size.Height;
      Marks.Add(mark);
      drawn.Lines.Add(new TextLine(Page, role, text, x, y, mark.W, size.Height));
    }

    public bool AddRight(Graphics measure, string role, string text, Font font, bool rtl, Drawn drawn)
    {
      Size size = TextRenderer.MeasureText(measure, text, font, new Size(int.MaxValue, int.MaxValue), HostMeasure(rtl));
      return PlaceBlock(measure, role, text, font, rtl, true, size, drawn);
    }

    public bool AddPair(Graphics measure, string role, string label, string value, Font font, bool valueRtl, Drawn drawn, int spaceBefore = 0)
    {
      bool labelRtl = HostArabic(label);
      Size labelSize = TextRenderer.MeasureText(measure, label, font, new Size(int.MaxValue, int.MaxValue), HostMeasure(labelRtl));
      Size valueSize = TextRenderer.MeasureText(measure, value, font, new Size(int.MaxValue, int.MaxValue), HostMeasure(valueRtl));
      if (labelSize.Width < 1 || valueSize.Width < 1 || labelSize.Height < 1 || valueSize.Height < 1) { Error = "invalid_layout"; return false; }
      int gap = Mm(2);
      if (labelSize.Width + valueSize.Width + gap <= TextW)
      {
        int height = Math.Max(labelSize.Height, valueSize.Height) + 2;
        if (!Ensure(height + spaceBefore)) { Error = Error ?? "invalid_layout"; return false; }
        Y += spaceBefore;
        AddText(role, label, font, labelRtl, TextLeft + TextW - labelSize.Width, Y, labelSize, drawn);
        AddText(role, value, font, valueRtl, TextLeft, Y, valueSize, drawn);
        Y += height;
        return true;
      }
      Y += spaceBefore;
      if (!PlaceBlock(measure, role, label, font, labelRtl, true, labelSize, drawn)) return false;
      return PlaceBlock(measure, role, value, font, valueRtl, false, valueSize, drawn);
    }

    public void AddSectionGap()
    {
      Y += Mm(1);
    }

    public bool AddItemRow(Graphics measure, string[] cells, bool heading, Font font, Drawn drawn)
    {
      int[] widths = {
        TextW * 9 / 100,
        TextW * 31 / 100,
        TextW * 17 / 100,
        TextW * 19 / 100,
        TextW - TextW * 9 / 100 - TextW * 31 / 100 - TextW * 17 / 100 - TextW * 19 / 100
      };
      string[] roles = heading
        ? new[] { "items-heading", "items-heading", "items-heading", "items-heading", "items-heading" }
        : new[] { "item-seq", "item-name", "item-quantity", "item-unit", "item-total" };
      int inset = Mm(0.4);
      List<string>[] lines = new List<string>[cells.Length];
      List<Size>[] sizes = new List<Size>[cells.Length];
      int rowHeight = 0;
      for (int column = 0; column < cells.Length; column++)
      {
        int wrapWidth = Math.Max(8, widths[column] - 2 * inset);
        lines[column] = HostWrap(measure, cells[column] == "" ? " " : cells[column], font, wrapWidth, HostArabic(cells[column]));
        if (lines[column] == null) { Error = "invalid_layout"; return false; }
        if (cells[column] == "") lines[column] = new List<string>();
        sizes[column] = new List<Size>();
        int cellHeight = 0;
        foreach (string text in lines[column])
        {
          Size size = TextRenderer.MeasureText(measure, text, font, new Size(int.MaxValue, int.MaxValue), HostMeasure(HostArabic(text)));
          sizes[column].Add(size);
          cellHeight += size.Height + 2;
        }
        rowHeight = Math.Max(rowHeight, Math.Max(cellHeight, Mm(3)));
      }
      if (!Ensure(rowHeight + 2 * inset)) return false;
      if (heading)
      {
        Mark fill = new Mark();
        fill.Kind = "fill";
        fill.Page = Page;
        fill.X = TextLeft;
        fill.Y = Y;
        fill.W = TextW;
        fill.H = rowHeight + 2 * inset;
        fill.Radius = Mm(1.4);
        Marks.Add(fill);
      }
      int bottom = Y + rowHeight + 2 * inset;

      int right = TextLeft + TextW;
      for (int column = 0; column < cells.Length; column++)
      {
        int y = Y + inset;
        for (int line = 0; line < lines[column].Count; line++)
        {
          string text = lines[column][line];
          Size size = sizes[column][line];
          AddText(roles[column], text, font, HostArabic(text), right - inset - size.Width, y, size, drawn);
          y += size.Height + 2;
        }
        right -= widths[column];
      }
      if (!heading) AddItemRule(bottom);
      Y = bottom;
      return true;
    }

    bool PlaceBlock(Graphics measure, string role, string text, Font font, bool rtl, bool alignRight, Size size, Drawn drawn)
    {
      if (size.Width <= TextW)
      {
        int height = size.Height + 2;
        if (!Ensure(height)) { Error = Error ?? "invalid_layout"; return false; }
        int x = alignRight ? TextLeft + TextW - size.Width : TextLeft;
        AddText(role, text, font, rtl, x, Y, size, drawn);
        Y += height;
        return true;
      }
      List<string> lines = HostWrap(measure, text, font, TextW, rtl);
      if (lines == null) { Error = "invalid_layout"; return false; }
      for (int i = 0; i < lines.Count; i++)
      {
        Size lineSize = TextRenderer.MeasureText(measure, lines[i], font, new Size(int.MaxValue, int.MaxValue), HostMeasure(rtl));
        int height = lineSize.Height + 2;
        if (lineSize.Width > TextW || !Ensure(height)) { Error = Error ?? "invalid_layout"; return false; }
        int x = alignRight ? TextLeft + TextW - lineSize.Width : TextLeft;
        AddText(role, lines[i], font, rtl, x, Y, lineSize, drawn);
        Y += height;
      }
      return true;
    }

    void AddItemRule(int y)
    {
      Mark mark = new Mark();
      mark.Kind = "rule";
      mark.Page = Page;
      mark.X = TextLeft;
      mark.Y = y;
      mark.W = TextW;
      Marks.Add(mark);
    }

    public void Finish()
    {
      if (Error != null) return;
      Heights[Page] = Y + Bottom;
      PageCount = Page + 1;
    }

    void AddText(string role, string text, Font font, bool rtl, int x, int y, Size size, Drawn drawn)
    {
      Mark mark = new Mark();
      mark.Kind = "text";
      mark.Page = Page;
      mark.Role = role;
      mark.Text = text;
      mark.Font = font;
      mark.Rtl = rtl;
      mark.X = x;
      mark.Y = y;
      mark.W = size.Width + 2;
      mark.H = size.Height;
      Marks.Add(mark);
      drawn.Lines.Add(new TextLine(Page, role, text, x, y, mark.W, size.Height));
    }

    bool Ensure(int height)
    {
      if (Error != null) return false;
      if (height < 1) { Error = "invalid_layout"; return false; }
      if (Y > Top && Y + height + Bottom > Max)
      {
        Heights[Page] = Y + Bottom;
        Page++;
        if (Page >= 6) { Error = "invalid_layout"; return false; }
        Y = Top;
      }
      if (Top + height + Bottom > Max) { Error = "invalid_layout"; return false; }
      return true;
    }

    static int Mm(double mm)
    {
      return (int)Math.Floor(mm * 203.0 / 25.4 + 0.5);
    }

    static bool HostArabic(string text)
    {
      if (text == null) return false;
      for (int i = 0; i < text.Length; i++)
      {
        char c = text[i];
        if (c >= '\u0600' && c <= '\u06FF') return true;
        if (c >= '\u0750' && c <= '\u077F') return true;
      }
      return false;
    }

    static TextFormatFlags HostMeasure(bool rtl)
    {
      TextFormatFlags flags = TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding | TextFormatFlags.SingleLine | TextFormatFlags.NoClipping | TextFormatFlags.Top;
      if (rtl) flags |= TextFormatFlags.RightToLeft | TextFormatFlags.Right;
      return flags;
    }

    static List<string> HostWrap(Graphics measure, string text, Font font, int maxWidth, bool rtl)
    {
      if (text == null || text.Length == 0) return null;
      List<string> lines = new List<string>();
      string rest = text;
      TextFormatFlags flags = HostMeasure(rtl);
      int guard = 0;
      while (rest.Length > 0)
      {
        guard++;
        if (guard > 24) return null;
        int count = Fit(measure, rest, font, maxWidth, flags);
        if (count <= 0) return null;
        if (count < rest.Length)
        {
          int space = rest.LastIndexOf(' ', count - 1, count);
          if (space > 0) count = space;
        }
        string line = rest.Substring(0, count);
        if (line.Length > 0 && line[line.Length - 1] == ' ') line = line.Substring(0, line.Length - 1);
        if (line.Length == 0) return null;
        Size size = TextRenderer.MeasureText(measure, line, font, new Size(int.MaxValue, int.MaxValue), flags);
        if (size.Width > maxWidth) return null;
        lines.Add(line);
        if (count >= rest.Length) break;
        rest = rest.Substring(count);
        if (rest.Length > 0 && rest[0] == ' ') rest = rest.Substring(1);
      }
      return lines;
    }

    static int Fit(Graphics measure, string text, Font font, int maxWidth, TextFormatFlags flags)
    {
      int lo = 1;
      int hi = text.Length;
      int best = 0;
      while (lo <= hi)
      {
        int mid = (lo + hi) / 2;
        Size size = TextRenderer.MeasureText(measure, text.Substring(0, mid), font, new Size(int.MaxValue, int.MaxValue), flags);
        if (size.Width <= maxWidth) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      return best;
    }
  }

  sealed class Fonts : IDisposable
  {
    [DllImport("gdi32.dll")]
    static extern IntPtr AddFontMemResourceEx(IntPtr pbFont, uint cbFont, IntPtr pdv, ref uint pcFonts);

    [DllImport("gdi32.dll")]
    static extern bool RemoveFontMemResourceEx(IntPtr fh);

    public Font LabelCode;
    public Font LabelName;
    public Font LabelBrand;
    public Font LabelPrice;
    public Font Body;
    public Font Meta;
    public Font Title;
    public Font Total;
    public Font Caption;
    public Image Logo;
    public string Error;
    IntPtr handle;
    IntPtr bytes;
    PrivateFontCollection collection;
    FontFamily family;

    public static Fonts Load(string fontPath, string logoPath)
    {
      Fonts fonts = new Fonts();
      try
      {
        byte[] file = File.ReadAllBytes(fontPath);
        if (file.Length < 10000 || file.Length > 2000000) { fonts.Error = "renderer_unavailable"; return fonts; }
        fonts.bytes = Marshal.AllocCoTaskMem(file.Length);
        Marshal.Copy(file, 0, fonts.bytes, file.Length);
        uint installed = 0;
        fonts.handle = AddFont(fonts.bytes, (uint)file.Length, ref installed);
        if (fonts.handle == IntPtr.Zero || installed < 1) { fonts.Error = "renderer_unavailable"; return fonts; }
        fonts.collection = new PrivateFontCollection();
        fonts.collection.AddMemoryFont(fonts.bytes, file.Length);
        if (fonts.collection.Families.Length < 1) { fonts.Error = "renderer_unavailable"; return fonts; }
        fonts.family = fonts.collection.Families[0];
        string name = fonts.family.Name;
        if (name.IndexOf("Cairo", StringComparison.OrdinalIgnoreCase) < 0) { fonts.Error = "renderer_unavailable"; return fonts; }
        fonts.LabelCode = Make(fonts.family, Mm(1.6));
        fonts.LabelName = Make(fonts.family, Mm(1.4));
        fonts.LabelBrand = MakeBold(fonts.family, Mm(1.6));
        fonts.LabelPrice = MakeBold(fonts.family, Mm(1.6));
        fonts.Body = Make(fonts.family, Px(9));
        fonts.Meta = Make(fonts.family, Px(8));
        fonts.Title = MakeBold(fonts.family, Px(9));
        fonts.Total = MakeBold(fonts.family, Px(13));
        fonts.Caption = MakeBold(fonts.family, Px(6));
        if (!Named(fonts.LabelCode) || !Named(fonts.Body) || !Named(fonts.LabelBrand)) { fonts.Error = "renderer_unavailable"; return fonts; }
        fonts.Logo = Image.FromFile(logoPath);
        if (fonts.Logo.Width < 8 || fonts.Logo.Height < 8 || fonts.Logo.Width > 4000 || fonts.Logo.Height > 4000)
        {
          fonts.Error = "renderer_unavailable";
        }
      }
      catch
      {
        fonts.Error = "renderer_unavailable";
      }
      return fonts;
    }

    static IntPtr AddFont(IntPtr data, uint length, ref uint installed)
    {
      return AddFontMemResourceEx(data, length, IntPtr.Zero, ref installed);
    }

    static Font Make(FontFamily family, int pixels)
    {
      return new Font(family, pixels, FontStyle.Regular, GraphicsUnit.Pixel);
    }

    static Font MakeBold(FontFamily family, int pixels)
    {
      return new Font(family, pixels, FontStyle.Bold, GraphicsUnit.Pixel);
    }

    static bool Named(Font font)
    {
      return font != null && font.Name.IndexOf("Cairo", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    static int Mm(double mm)
    {
      return (int)Math.Floor(mm * 203.0 / 25.4 + 0.5);
    }

    static int Px(int cssPx)
    {
      return (int)Math.Floor(cssPx * 203.0 / 96.0 + 0.5);
    }

    public void Dispose()
    {
      if (LabelCode != null) LabelCode.Dispose();
      if (LabelName != null) LabelName.Dispose();
      if (LabelBrand != null) LabelBrand.Dispose();
      if (LabelPrice != null) LabelPrice.Dispose();
      if (Body != null) Body.Dispose();
      if (Meta != null) Meta.Dispose();
      if (Title != null) Title.Dispose();
      if (Total != null) Total.Dispose();
      if (Caption != null) Caption.Dispose();
      if (Logo != null) Logo.Dispose();
      if (family != null) family.Dispose();
      if (collection != null) collection.Dispose();
      if (handle != IntPtr.Zero) RemoveFontMemResourceEx(handle);
      if (bytes != IntPtr.Zero) Marshal.FreeCoTaskMem(bytes);
      handle = IntPtr.Zero;
      bytes = IntPtr.Zero;
    }
  }
}
