type ContactLink = { label: string; href: string };

export function StoreFooter({ contactLinks }: { contactLinks: ContactLink[] }) {
  return (
    <footer className="store-footer">
      <div>
        <img className="footer-brand" src="/brand/02_Logo_Horizontal_Black.svg" alt="برافوس" width={140} height={59} />
        <p>ملابس رجالي مختارة بعناية في الفيوم.</p>
      </div>
      {contactLinks.length > 0 ? (
        <nav aria-label="روابط التواصل">
          {contactLinks.map((item) => (
            <a href={item.href} key={item.label} target="_blank" rel="noreferrer">{item.label}</a>
          ))}
        </nav>
      ) : null}
    </footer>
  );
}
