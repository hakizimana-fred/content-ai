import { NextRequest, NextResponse } from 'next/server';
import { getAllProjects, upsertProject } from '@/lib/db';
import { VideoProject } from '@/types/video';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || undefined;
    const sortBy = (searchParams.get('sortBy') as any) || 'updated';
    const sortOrder = (searchParams.get('sortOrder') as any) || 'desc';

    const projects = getAllProjects({ search, sortBy, sortOrder });

    return NextResponse.json({
      success: true,
      projects,
      total: projects.length,
    });
  } catch (err) {
    console.error('Failed to get projects:', err);
    return NextResponse.json(
      { success: false, error: (err as Error).message || 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: VideoProject = await request.json();
    if (!body?.id || !body?.title || !body?.localPath) {
      return NextResponse.json({ success: false, error: 'Invalid project data' }, { status: 400 });
    }

    const saved = upsertProject(body);
    return NextResponse.json({ success: true, project: saved });
  } catch (err) {
    console.error('Failed to save project:', err);
    return NextResponse.json(
      { success: false, error: (err as Error).message || 'Failed to save project' },
      { status: 500 }
    );
  }
}
