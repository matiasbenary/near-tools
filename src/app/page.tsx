import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { tools } from '@/lib/tools';

export default function Home() {
  return (
    <main className="wrap home-page">
      <section className="hero hero-single" aria-labelledby="home-title">
        <div className="hero-copy">
          <h1 id="home-title">Because NEAR deserves<br /><em>simpler tools</em></h1>
          <p>Stake, create, share, and manage your assets with your own wallet.</p>
          <Link className="btn hero-cta" href="#tools">Explore tools</Link>
        </div>
      </section>
      <section id="tools" className="tool-directory" aria-labelledby="tools-title">
        <h2 id="tools-title">What would you like to do?</h2>
        <ul>
          {tools.map((tool) => (
            <li key={tool.kind}>
              <Link href={tool.href} className="tool-directory-link">
                <h3>{tool.title}</h3>
                <p>{tool.description}</p>
                <ArrowUpRight size={20} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
